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

	const REMOTE    = 'https://raw.githubusercontent.com/jonathanothen/nb-skotsel/main/library/';
	const CACHE_KEY = 'nbs_library';

	public static function get($refresh = false) {
		$cached = get_site_transient(self::CACHE_KEY);
		if (!$refresh && is_array($cached)) {
			return $cached;
		}
		$lib = self::fetch_remote();
		if ($lib) {
			$lib['origin'] = 'github';
			$lib['base']   = self::REMOTE;
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

	private static function fetch_remote() {
		$res = wp_remote_get(self::REMOTE . 'index.json', ['timeout' => 10, 'headers' => ['Cache-Control' => 'no-cache']]);
		if (is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 200) {
			return null;
		}
		return self::clean(json_decode(wp_remote_retrieve_body($res), true));
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
			'frames'  => $frames,
		];
	}
}
