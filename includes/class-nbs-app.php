<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * Appen visas på /skotsel/ som en egen helskärmssida utan temats sidhuvud (mobilvänlig,
 * noindex, kräver inloggning) och som en sida i WP-admin. Båda laddar samma React-app.
 */
class NBS_App {

	const SLUG = 'skotsel';

	public static function init() {
		add_action('init', [__CLASS__, 'add_rewrite']);
		add_filter('query_vars', function ($vars) {
			$vars[] = 'nbs_app';
			return $vars;
		});
		add_action('template_redirect', [__CLASS__, 'render_page']);
		add_action('admin_menu', [__CLASS__, 'admin_menu']);
		add_filter('wp_robots', function ($robots) {
			if (get_query_var('nbs_app')) {
				$robots['noindex']  = true;
				$robots['nofollow'] = true;
			}
			return $robots;
		});
	}

	public static function add_rewrite() {
		add_rewrite_rule('^' . self::SLUG . '/?(.*)?$', 'index.php?nbs_app=1', 'top');
	}

	public static function url($path = '') {
		return home_url('/' . self::SLUG . '/' . ltrim($path, '/'));
	}

	private static function asset_meta() {
		$file = NBS_DIR . 'build/index.asset.php';
		return file_exists($file) ? include $file : ['dependencies' => ['wp-element', 'wp-api-fetch'], 'version' => NBS_VERSION];
	}

	private static function enqueue($base) {
		$meta = self::asset_meta();
		wp_enqueue_script('nbs-app', NBS_URL . 'build/index.js', $meta['dependencies'], $meta['version'], true);
		// index.css = bibliotek som importeras från JS (kartan), style-index.css = appens egna stilar.
		wp_register_style('nbs-vendor', NBS_URL . 'build/index.css', [], $meta['version']);
		wp_enqueue_style('nbs-app', NBS_URL . 'build/style-index.css', ['nbs-vendor'], $meta['version']);
		wp_add_inline_script('nbs-app', 'window.NBS = ' . wp_json_encode([
			'root'    => esc_url_raw(rest_url('nbs/v1/')),
			'nonce'   => wp_create_nonce('wp_rest'),
			'base'    => $base,
			'site'    => get_bloginfo('name'),
			'home'    => home_url('/'),
			'logout'  => wp_logout_url(home_url('/')),
			'admin'   => current_user_can('manage_options') ? admin_url() : '',
		]) . ';', 'before');
	}

	public static function render_page() {
		if (!get_query_var('nbs_app')) {
			return;
		}
		nocache_headers();
		if (!is_user_logged_in()) {
			wp_safe_redirect(wp_login_url(self::url()));
			exit;
		}
		if (!NBS_Auth::can_access()) {
			wp_die('Du har inte tillgång till skötselsystemet. Be en administratör lägga till dig.', 'Ingen åtkomst', ['response' => 403]);
		}
		if (!NBS_Auth::org_id()) {
			wp_die('Ditt konto är inte kopplat till någon biodling ännu. Be ägaren lägga till dig under Inställningar → Medlemmar.', 'Ingen biodling', ['response' => 403]);
		}
		self::enqueue(wp_parse_url(self::url(), PHP_URL_PATH));
		?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo('charset'); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#3B2A1A">
<title>Skötsel – <?php echo esc_html(get_bloginfo('name')); ?></title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=DM+Sans:wght@400;500;600;700&display=swap">
<?php wp_print_styles(['nbs-app']); ?>
</head>
<body class="nbs-body">
<div id="nbs-root"><p style="padding:24px;font-family:sans-serif">Laddar…</p></div>
<?php wp_print_scripts(['nbs-app']); ?>
</body>
</html>
		<?php
		exit;
	}

	public static function admin_menu() {
		if (!NBS_Auth::can_access()) {
			return;
		}
		$hook = add_menu_page('Skötsel', 'Skötsel', 'nbs_access', 'nbs-app', [__CLASS__, 'admin_page'], 'dashicons-carrot', 3);
		add_action('load-' . $hook, function () {
			self::enqueue('admin');
		});
	}

	public static function admin_page() {
		echo '<div class="wrap nbs-admin-wrap"><p><a class="button" href="' . esc_url(self::url()) . '" target="_blank" rel="noopener">Öppna i helskärm (bra i mobilen)</a></p><div id="nbs-root"></div></div>';
	}
}
