<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * Uppdateringar inifrån appen: pluginet och det gemensamma kupbiblioteket från GitHub.
 *
 * Kontrollen tömmer uppdaterarens och WordPress cache och läser versionen på nytt.
 * Själva uppdateringen görs som WordPress egen "Uppdatera nu" på tilläggssidan
 * (bulk_upgrade), så pluginet förblir aktiverat.
 */
class NBS_Updates {

	const REPO = 'jonathanothen/nb-skotsel';

	private static function basename() {
		return plugin_basename(NBS_DIR . 'nb-skotsel.php');
	}

	private static function remote_version($ref = 'main') {
		$res = wp_remote_get(NBS_Library::raw_url($ref, 'nb-skotsel.php'), ['timeout' => 10, 'headers' => ['Cache-Control' => 'no-cache']]);
		if (is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 200) {
			return null;
		}
		return preg_match('/^[ \t\/*#@]*Version:\s*([0-9][0-9a-z.\-]*)/mi', wp_remote_retrieve_body($res), $m) ? $m[1] : null;
	}

	public static function status($ref = 'main') {
		$lib    = NBS_Library::get();
		$remote = self::remote_version($ref);
		return [
			'plugin'  => [
				'installed'  => NBS_VERSION,
				'remote'     => $remote,
				'available'  => $remote && version_compare($remote, NBS_VERSION, '>'),
				'can_update' => current_user_can('update_plugins'),
				'admin_url'  => self_admin_url('plugins.php'),
			],
			'library' => is_wp_error($lib) ? ['error' => $lib->get_error_message()] : [
				'version' => $lib['version'],
				'origin'  => $lib['origin'],
				'fetched' => $lib['fetched'] ?? '',
				'parts'   => count($lib['parts']),
				'frames'  => count($lib['frames']),
			],
		];
	}

	/** Sök efter uppdateringar: biblioteket hämtas på nytt och pluginets version läses om. */
	public static function check() {
		NBS_Library::get(true);
		delete_site_transient('nb_gh_' . md5(self::REPO . 'main'));
		delete_site_transient('update_plugins');
		if (!function_exists('wp_update_plugins')) {
			require_once ABSPATH . 'wp-includes/update.php';
		}
		wp_update_plugins();
		$sha    = NBS_Library::head_sha();
		$status = self::status($sha);
		if ($status['plugin']['available']) {
			self::offer($status['plugin']['remote'], $sha);
		}
		return $status + ['ref' => $sha];
	}

	/**
	 * Lägger in uppdateringen i WordPress lista, med paketet från just den commit som lästes.
	 * Uppdateraren läser main via raw-cachen och kan några minuter efter en push fortfarande
	 * se den gamla versionen – då skulle "Uppdatera nu" annars inte hitta något.
	 */
	private static function offer($version, $ref) {
		$t = get_site_transient('update_plugins');
		if (!is_object($t)) {
			$t = new stdClass();
		}
		$t->response                     = isset($t->response) && is_array($t->response) ? $t->response : [];
		$t->response[self::basename()]   = (object) [
			'id'          => self::REPO,
			'slug'        => 'nb-skotsel',
			'plugin'      => self::basename(),
			'new_version' => $version,
			'url'         => 'https://github.com/' . self::REPO,
			'package'     => 'https://github.com/' . self::REPO . '/archive/' . $ref . '.zip',
		];
		if (isset($t->no_update[self::basename()])) {
			unset($t->no_update[self::basename()]);
		}
		set_site_transient('update_plugins', $t);
	}

	public static function update_plugin() {
		if (!current_user_can('update_plugins')) {
			return new WP_Error('nbs_forbidden', 'Ditt konto får inte uppdatera tillägg. Be en administratör.', ['status' => 403]);
		}
		$status = self::check();
		if (!$status['plugin']['available']) {
			return $status + ['message' => 'Du har redan senaste versionen.'];
		}
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/misc.php';
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
		$skin     = new WP_Ajax_Upgrader_Skin();
		$upgrader = new Plugin_Upgrader($skin);
		$result   = $upgrader->bulk_upgrade([self::basename()]);
		if ($skin->get_errors()->has_errors()) {
			return new WP_Error('nbs_update', 'Uppdateringen misslyckades: ' . $skin->get_error_messages(), ['status' => 500]);
		}
		if ($result === false || empty($result[self::basename()]) || is_wp_error($result[self::basename()])) {
			// T.ex. när servern kräver FTP-uppgifter: då måste uppdateringen göras på tilläggssidan.
			return new WP_Error('nbs_update', 'Uppdateringen kunde inte göras härifrån. Uppdatera på tilläggssidan i WP-admin.', ['status' => 500]);
		}
		$data = get_plugin_data(NBS_DIR . 'nb-skotsel.php', false, false);
		return ['updated' => $data['Version'], 'message' => 'Pluginet är uppdaterat till version ' . $data['Version'] . '. Sidan laddas om.'];
	}
}
