<?php
if (!defined('ABSPATH')) {
	exit;
}

if (!class_exists('NB_GitHub_Updater')) {
	/**
	 * Uppdateringar direkt från ett publikt GitHub-repo.
	 *
	 * Versionen läses från plugin-filens huvud på huvudgrenen. Är den högre än den
	 * installerade visas en vanlig uppdatering i WordPress, och paketet hämtas som zip
	 * från grenen. Mappnamnet rättas efter uppackning så att pluginet behåller sin plats.
	 * Länken "Sök efter uppdateringar" på tilläggssidan tvingar fram en ny kontroll.
	 */
	class NB_GitHub_Updater {

		private $file;
		private $basename;
		private $slug;
		private $repo;
		private $branch;
		private $cache_key;

		public function __construct($file, $repo, $branch = 'main') {
			$this->file      = $file;
			$this->basename  = plugin_basename($file);
			$this->slug      = dirname($this->basename);
			$this->repo      = $repo;
			$this->branch    = $branch;
			$this->cache_key = 'nb_gh_' . md5($repo . $branch);

			add_filter('pre_set_site_transient_update_plugins', [$this, 'check']);
			add_filter('plugins_api', [$this, 'info'], 20, 3);
			add_filter('upgrader_source_selection', [$this, 'fix_folder'], 10, 4);
			add_filter('plugin_action_links_' . $this->basename, [$this, 'action_links']);
			add_action('admin_init', [$this, 'maybe_force_check']);
			add_action('admin_notices', [$this, 'notice']);
		}

		private function installed_version() {
			if (!function_exists('get_plugin_data')) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}
			$data = get_plugin_data($this->file, false, false);
			return $data['Version'];
		}

		/** Hämtar versionsnummer m.m. från GitHub, cachat i sex timmar. */
		private function remote($force = false) {
			$cached = get_site_transient($this->cache_key);
			if (!$force && is_array($cached)) {
				return $cached;
			}
			$url = sprintf('https://raw.githubusercontent.com/%s/%s/%s.php', $this->repo, $this->branch, $this->slug);
			$res = wp_remote_get($url, ['timeout' => 10, 'headers' => ['Cache-Control' => 'no-cache']]);
			if (is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 200) {
				set_site_transient($this->cache_key, ['version' => '', 'error' => true], HOUR_IN_SECONDS);
				return null;
			}
			$body = wp_remote_retrieve_body($res);
			$info = ['version' => '', 'name' => '', 'description' => '', 'requires' => '', 'requires_php' => ''];
			$map  = ['version' => 'Version', 'name' => 'Plugin Name', 'description' => 'Description', 'requires' => 'Requires at least', 'requires_php' => 'Requires PHP'];
			foreach ($map as $key => $header) {
				if (preg_match('/^[ \t\/*#@]*' . preg_quote($header, '/') . ':(.*)$/mi', $body, $m)) {
					$info[$key] = trim($m[1]);
				}
			}
			set_site_transient($this->cache_key, $info, 6 * HOUR_IN_SECONDS);
			return $info;
		}

		private function package_url() {
			return sprintf('https://github.com/%s/archive/refs/heads/%s.zip', $this->repo, $this->branch);
		}

		public function check($transient) {
			if (!is_object($transient) || empty($transient->checked)) {
				return $transient;
			}
			$remote = $this->remote();
			$item   = (object) [
				'id'          => $this->repo,
				'slug'        => $this->slug,
				'plugin'      => $this->basename,
				'new_version' => $remote['version'] ?? $this->installed_version(),
				'url'         => 'https://github.com/' . $this->repo,
				'package'     => $this->package_url(),
			];
			if ($remote && $remote['version'] && version_compare($remote['version'], $this->installed_version(), '>')) {
				$transient->response[$this->basename] = $item;
			} else {
				$transient->no_update[$this->basename] = $item;
			}
			return $transient;
		}

		public function info($result, $action, $args) {
			if ($action !== 'plugin_information' || empty($args->slug) || $args->slug !== $this->slug) {
				return $result;
			}
			$remote = $this->remote();
			return (object) [
				'name'          => $remote['name'] ?? $this->slug,
				'slug'          => $this->slug,
				'version'       => $remote['version'] ?? '',
				'requires'      => $remote['requires'] ?? '',
				'requires_php'  => $remote['requires_php'] ?? '',
				'homepage'      => 'https://github.com/' . $this->repo,
				'download_link' => $this->package_url(),
				'sections'      => [
					'description' => esc_html($remote['description'] ?? ''),
					'changelog'   => '<p><a href="https://github.com/' . esc_attr($this->repo) . '/commits/' . esc_attr($this->branch) . '" target="_blank" rel="noopener">Se ändringar på GitHub</a></p>',
				],
			];
		}

		/** GitHub-zippen packas upp som "repo-gren/"; byt namn till pluginets mapp. */
		public function fix_folder($source, $remote_source, $upgrader, $hook_extra = []) {
			if (empty($hook_extra['plugin']) || $hook_extra['plugin'] !== $this->basename) {
				return $source;
			}
			global $wp_filesystem;
			$target = trailingslashit($remote_source) . $this->slug . '/';
			if (untrailingslashit($source) === untrailingslashit($target)) {
				return $source;
			}
			if ($wp_filesystem && $wp_filesystem->move($source, $target, true)) {
				return $target;
			}
			return new WP_Error('nb_gh_folder', 'Kunde inte byta namn på uppdateringens mapp.');
		}

		public function action_links($links) {
			$url     = wp_nonce_url(add_query_arg(['nb_gh_check' => $this->slug], self_admin_url('plugins.php')), 'nb_gh_check_' . $this->slug);
			$links[] = '<a href="' . esc_url($url) . '">Sök efter uppdateringar</a>';
			return $links;
		}

		public function maybe_force_check() {
			if (!isset($_GET['nb_gh_check']) || $_GET['nb_gh_check'] !== $this->slug || !current_user_can('update_plugins')) {
				return;
			}
			check_admin_referer('nb_gh_check_' . $this->slug);
			delete_site_transient($this->cache_key);
			$remote = $this->remote(true);
			delete_site_transient('update_plugins');
			wp_update_plugins();
			$state = !$remote ? 'error' : (version_compare($remote['version'], $this->installed_version(), '>') ? 'new' : 'none');
			wp_safe_redirect(add_query_arg(['nb_gh_result' => $state, 'nb_gh_slug' => $this->slug], self_admin_url('plugins.php')));
			exit;
		}

		public function notice() {
			if (!isset($_GET['nb_gh_result'], $_GET['nb_gh_slug']) || $_GET['nb_gh_slug'] !== $this->slug) {
				return;
			}
			$remote = $this->remote();
			$msgs   = [
				'new'   => ['warning', sprintf('Version %s finns. Klicka på "Uppdatera nu" under pluginet.', $remote['version'] ?? '')],
				'none'  => ['success', 'Du har senaste versionen.'],
				'error' => ['error', 'Kunde inte nå GitHub. Försök igen senare.'],
			];
			$key = sanitize_key($_GET['nb_gh_result']);
			if (isset($msgs[$key])) {
				printf('<div class="notice notice-%s is-dismissible"><p><strong>%s:</strong> %s</p></div>', esc_attr($msgs[$key][0]), esc_html($this->slug), esc_html($msgs[$key][1]));
			}
		}
	}
}
