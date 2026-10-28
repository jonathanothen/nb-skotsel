<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * Det gemensamma kupbiblioteket: ramformat, system och kupdelar för alla som har pluginet.
 *
 * Källan är library/index.json på huvudgrenen i GitHub-repot, så nya delar kan läggas till
 * utan att pluginet släpps i en ny version. Svaret cachas i tolv timmar. Går GitHub inte att
 * nå används kopian som följer med pluginet. Modellfilerna hämtas från samma ställe som
 * indexet, eftersom ett nytt index kan peka på filer som pluginets kopia saknar.
 */
class NBS_Library {

	const REPO      = 'jonathanothen/nb-skotsel';
	const CACHE_KEY = 'nbs_library';

	/**
	 * Senaste commit på main. raw.githubusercontent cachar main i flera minuter efter en push,
	 * men en fil hämtad på commit-id är alltid aktuell (och kan cachas för alltid av webbläsaren).
	 * Används bara när någon trycker på en knapp – GitHubs API tillåter 60 anrop i timmen.
	 */
	public static function head_sha() {
		$res = wp_remote_get('https://api.github.com/repos/' . self::REPO . '/commits/main', ['timeout' => 10, 'headers' => ['Accept' => 'application/vnd.github.sha']]);
		$sha = is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 200 ? '' : trim(wp_remote_retrieve_body($res));
		return preg_match('/^[0-9a-f]{40}$/', $sha) ? $sha : 'main';
	}

	public static function raw_url($ref, $path) {
		return 'https://raw.githubusercontent.com/' . self::REPO . '/' . $ref . '/' . $path;
	}

	public static function get($refresh = false) {
		$cached = get_site_transient(self::CACHE_KEY);
		// En nyare kopia i pluginet (efter en uppdatering) ska inte vänta på att cachen går ut.
		$local_version = self::local_version();
		if (!$refresh && is_array($cached) && strcmp($local_version, (string) $cached['version']) <= 0) {
			return $cached;
		}
		$ref = $refresh ? self::head_sha() : 'main';
		$lib = self::fetch_remote($ref);
		if ($lib) {
			$lib['origin'] = 'github';
			$lib['base']   = self::raw_url($ref, 'library/');
		} else {
			$lib = self::local();
			if (!$lib) {
				return new WP_Error('nbs_library', 'Kupbiblioteket kunde inte läsas.', ['status' => 500]);
			}
			$lib['origin'] = 'plugin';
			$lib['base']   = NBS_URL . 'library/';
		}
		// Är pluginets kopia nyare (t.ex. under utveckling) vinner den.
		$local = self::local();
		if ($lib['origin'] === 'github' && $local && strcmp((string) $local['version'], (string) $lib['version']) > 0) {
			$lib = $local + ['origin' => 'plugin', 'base' => NBS_URL . 'library/'];
		}
		$lib['fetched'] = gmdate('c');
		// Kortare cache om GitHub inte svarade, så att ett nytt försök görs snart.
		set_site_transient(self::CACHE_KEY, $lib, $lib['origin'] === 'github' ? 12 * HOUR_IN_SECONDS : HOUR_IN_SECONDS);
		return $lib;
	}

	private static function fetch_remote($ref) {
		$res = wp_remote_get(self::raw_url($ref, 'library/index.json'), ['timeout' => 10, 'headers' => ['Cache-Control' => 'no-cache']]);
		if (is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 200) {
			return null;
		}
		return self::clean(json_decode(wp_remote_retrieve_body($res), true));
	}

	private static function local_version() {
		$file = NBS_DIR . 'library/index.json';
		$head = file_exists($file) ? (string) file_get_contents($file, false, null, 0, 400) : '';
		return preg_match('/"version"\s*:\s*"([^"]+)"/', $head, $m) ? $m[1] : '';
	}

	private static function local() {
		$file = NBS_DIR . 'library/index.json';
		return file_exists($file) ? self::clean(json_decode((string) file_get_contents($file), true)) : null;
	}

	/** Bara kända nycklar och relativa modellsökvägar släpps igenom. */
	private static function clean($lib) {
		if (!is_array($lib) || (int) ($lib['schema'] ?? 0) !== 1) {
			return null;
		}
		$list = function ($key) use ($lib) {
			return array_values(array_filter((array) ($lib[$key] ?? []), function ($x) {
				return is_array($x) && !empty($x['id']) && is_string($x['id']);
			}));
		};
		$frames = array_map(function ($f) {
			if (isset($f['model']) && !preg_match('#^[a-z0-9_\-]+(/[a-z0-9_\-]+)*\.glb$#', (string) $f['model'])) {
				unset($f['model']);
			}
			return $f;
		}, $list('frames'));
		return [
			'schema'  => 1,
			'version' => (string) ($lib['version'] ?? ''),
			'brands'  => $list('brands'),
			'systems' => $list('systems'),
			'parts'   => $list('parts'),
			'kits'    => $list('kits'),
			'retailers' => $list('retailers'),
			'frames'  => $frames,
		];
	}
}
