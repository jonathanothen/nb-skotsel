<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * Export och import av biodlingens data (JSON, eller Excel som appen gör om till samma format).
 *
 * Import i två lägen:
 *   merge   – raderna i filen skriver över raderna med samma id (eller samma nyckel), övrigt behålls.
 *   replace – biodlingens rader i tabellerna som finns i filen tas bort och ersätts med filens.
 * Raderna får alltid den inloggade biodlingens org_id. Allt sker i en databastransaktion.
 */
class NBS_Transfer {

	const TABLES = ['lists', 'list_items', 'apiaries', 'hives', 'colonies', 'queens', 'events', 'stock_tx', 'stock', 'templates', 'visits', 'inspections', 'plan', 'health', 'batches', 'fills', 'deliveries', 'haccp', 'evaluations', 'rearing', 'budget', 'ledger', 'investments', 'hivetypes'];

	public static function export($org_id) {
		global $wpdb;
		$out = ['exported_at' => gmdate('c'), 'version' => NBS_VERSION, 'org' => NBS_Auth::current(), 'org_settings' => NBS_Auth::org_settings($org_id)];
		foreach (self::TABLES as $t) {
			$out[$t] = $wpdb->get_results($wpdb->prepare('SELECT * FROM ' . NBS_DB::table($t) . ' WHERE org_id = %s', $org_id), ARRAY_A);
		}
		return $out;
	}

	public static function import($org_id, $data, $mode) {
		global $wpdb;
		if (!is_array($data)) {
			return new WP_Error('nbs_import', 'Filen innehåller ingen data.', ['status' => 400]);
		}
		$mode   = $mode === 'replace' ? 'replace' : 'merge';
		$tables = array_values(array_filter(self::TABLES, function ($t) use ($data) {
			return isset($data[$t]) && is_array($data[$t]);
		}));
		if (!$tables) {
			return new WP_Error('nbs_import', 'Filen innehåller inga tabeller från skötselsystemet. Använd en export från Inställningar → Export.', ['status' => 400]);
		}
		$counts = [];
		foreach ($tables as $t) {
			$table = NBS_DB::table($t);
			$cols  = array_map('strtolower', (array) $wpdb->get_col("SHOW COLUMNS FROM $table", 0)); // phpcs:ignore
			if (!$cols) {
				continue;
			}
			if ($mode === 'replace') {
				$wpdb->delete($table, ['org_id' => $org_id]);
			}
			$n = 0;
			foreach ($data[$t] as $row) {
				if (!is_array($row)) {
					continue;
				}
				$set = [];
				foreach ($row as $k => $v) {
					$k = strtolower((string) $k);
					if (in_array($k, $cols, true)) {
						$set[$k] = is_array($v) || is_object($v) ? wp_json_encode($v) : $v;
					}
				}
				$set['org_id'] = $org_id;
				if (in_array('id', $cols, true) && empty($set['id'])) {
					continue;
				}
				// REPLACE skriver över raden med samma primärnyckel (id, eller lagrets plats och artikel).
				if ($wpdb->replace($table, $set) === false) {
					return new WP_Error('nbs_import', sprintf('Raden %s i %s kunde inte läsas in: %s', $set['id'] ?? '', $t, wp_strip_all_tags((string) $wpdb->last_error)), ['status' => 400]);
				}
				$n++;
			}
			$counts[$t] = $n;
		}
		if ($mode === 'replace' && isset($data['org_settings']) && is_array($data['org_settings'])) {
			NBS_Auth::save_org_settings($org_id, $data['org_settings']);
		}
		NBS_Repo::audit('import', $org_id, 'create', ['mode' => $mode, 'counts' => $counts]);
		return ['mode' => $mode, 'counts' => $counts];
	}
}
