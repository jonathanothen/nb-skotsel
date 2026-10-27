<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * Historik: allt som händer ett samhälle, en drottning eller en bigård sparas som en
 * händelse med datum. Läget i registren är "nuläget", händelserna är hur man kom dit.
 *
 * Typer: skapad, bildad, flytt, kupbyte, drottning_in, drottning_ut, delning,
 * sammanslagning, forstarkt, status, avslutad, anteckning.
 */
class NBS_Events {

	const TYPES = ['skapad', 'bildad', 'flytt', 'kupbyte', 'drottning_in', 'drottning_ut', 'delning', 'sammanslagning', 'forstarkt', 'status', 'avslutad', 'anteckning'];

	public static function add($org_id, $type, $refs = [], $date = null, $note = '') {
		global $wpdb;
		$id = NBS_Repo::id($refs['id'] ?? null);
		$wpdb->insert(NBS_DB::table('events'), [
			'id'         => $id,
			'org_id'     => $org_id,
			'event_date' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $date) ? $date : current_time('Y-m-d'),
			'type'       => in_array($type, self::TYPES, true) ? $type : 'anteckning',
			'colony_id'  => $refs['colony_id'] ?? null,
			'queen_id'   => $refs['queen_id'] ?? null,
			'apiary_id'  => $refs['apiary_id'] ?? null,
			'from_id'    => $refs['from_id'] ?? null,
			'other_id'   => $refs['other_id'] ?? null,
			'data'       => isset($refs['data']) ? NBS_Repo::json($refs['data']) : null,
			'note'       => $note !== '' ? sanitize_textarea_field($note) : null,
			'created_at' => NBS_DB::now(),
			'created_by' => get_current_user_id() ?: null,
		]);
		return $id;
	}

	private static function cast($r) {
		return [
			'id'        => $r['id'],
			'date'      => $r['event_date'],
			'type'      => $r['type'],
			'colony_id' => $r['colony_id'],
			'queen_id'  => $r['queen_id'],
			'apiary_id' => $r['apiary_id'],
			'from_id'   => $r['from_id'],
			'other_id'  => $r['other_id'],
			'data'      => (object) NBS_Repo::unjson($r['data']),
			'note'      => (string) $r['note'],
			'user'      => $r['user'] ?? '',
			'created_at' => $r['created_at'],
		];
	}

	/** Händelser för ett samhälle, en drottning eller en bigård, nyast först. */
	public static function query($org_id, $filter, $limit = 300) {
		global $wpdb;
		$t     = NBS_DB::table('events');
		$where = $wpdb->prepare('e.org_id = %s', $org_id);
		if (!empty($filter['colony_id'])) {
			$where .= $wpdb->prepare(' AND e.colony_id = %s', $filter['colony_id']);
		}
		if (!empty($filter['queen_id'])) {
			$where .= $wpdb->prepare(' AND e.queen_id = %s', $filter['queen_id']);
		}
		if (!empty($filter['apiary_id'])) {
			$where .= $wpdb->prepare(' AND (e.apiary_id = %s OR e.from_id = %s)', $filter['apiary_id'], $filter['apiary_id']);
		}
		$limit = max(1, min(1000, (int) $limit));
		$u     = $wpdb->users;
		$rows  = $wpdb->get_results("SELECT e.*, u.display_name AS user FROM $t e LEFT JOIN $u u ON u.ID = e.created_by WHERE $where ORDER BY e.event_date DESC, e.created_at DESC LIMIT $limit", ARRAY_A); // phpcs:ignore
		return array_map([__CLASS__, 'cast'], $rows);
	}

	/** Bara anteckningar kan tas bort; övrig historik hör ihop med registren. */
	public static function delete($org_id, $id) {
		global $wpdb;
		$t   = NBS_DB::table('events');
		$row = $wpdb->get_row($wpdb->prepare("SELECT * FROM $t WHERE org_id = %s AND id = %s", $org_id, $id), ARRAY_A); // phpcs:ignore
		if (!$row) {
			return new WP_Error('nbs_404', 'Händelsen finns inte.', ['status' => 404]);
		}
		if ($row['type'] !== 'anteckning') {
			return new WP_Error('nbs_event', 'Bara anteckningar kan tas bort. Övrig historik ändras genom att göra en ny åtgärd.', ['status' => 400]);
		}
		$wpdb->delete($t, ['id' => $id, 'org_id' => $org_id]);
		NBS_Repo::audit('event', $id, 'delete', ['note' => $row['note']]);
		return true;
	}
}
