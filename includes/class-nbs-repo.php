<?php
if (!defined('ABSPATH')) {
	exit;
}

/** Gemensamma hjälpfunktioner: JSON, validering av id och ändringslogg. */
class NBS_Repo {

	public static function json($value) {
		return wp_json_encode($value, JSON_UNESCAPED_UNICODE);
	}

	public static function unjson($value, $default = []) {
		if ($value === null || $value === '') {
			return $default;
		}
		$v = json_decode($value, true);
		return is_array($v) ? $v : $default;
	}

	public static function is_uuid($v) {
		return is_string($v) && (bool) preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $v);
	}

	/** Id från klienten om det är ett giltigt UUID, annars ett nytt. */
	public static function id($maybe = null) {
		return self::is_uuid($maybe) ? strtolower($maybe) : wp_generate_uuid4();
	}

	public static function color($v) {
		$v = is_string($v) ? trim($v) : '';
		return preg_match('/^#[0-9a-f]{6}$/i', $v) ? strtoupper($v) : null;
	}

	/** Loggar en ändring: action = create|update|delete, changes = fält som ändrats. */
	public static function audit($entity, $entity_id, $action, $changes = null) {
		global $wpdb;
		$org = NBS_Auth::org_id();
		if (!$org) {
			return;
		}
		$wpdb->insert(NBS_DB::table('audit'), [
			'org_id'     => $org,
			'user_id'    => get_current_user_id() ?: null,
			'entity'     => $entity,
			'entity_id'  => $entity_id,
			'action'     => $action,
			'changes'    => $changes === null ? null : self::json($changes),
			'created_at' => NBS_DB::now(),
		]);
	}

	/** Skillnad mellan två rader (bara ändrade nycklar). */
	public static function diff($before, $after) {
		$out = [];
		foreach ($after as $k => $v) {
			$old = $before[$k] ?? null;
			if ($old != $v) { // phpcs:ignore -- lös jämförelse avsiktlig (sträng/tal från DB).
				$out[$k] = [$old, $v];
			}
		}
		return $out;
	}
}
