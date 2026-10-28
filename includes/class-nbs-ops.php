<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * Operationer på samhällen. Varje operation uppdaterar nuläget i registren och skriver
 * händelser, så att historiken alltid stämmer med registret. Anropen från REST körs i
 * en transaktion (tx) så att en operation inte blir halvgjord.
 */
class NBS_Ops {

	public static function tx(callable $fn) {
		global $wpdb;
		$wpdb->query('START TRANSACTION');
		try {
			$res = $fn();
		} catch (Throwable $e) {
			$wpdb->query('ROLLBACK');
			return new WP_Error('nbs_error', $e->getMessage(), ['status' => 500]);
		}
		$wpdb->query(is_wp_error($res) ? 'ROLLBACK' : 'COMMIT');
		return $res;
	}

	private static function colony($org_id, $id) {
		$c = NBS_Entities::get($org_id, 'colony', $id);
		return $c ?: new WP_Error('nbs_404', 'Samhället finns inte.', ['status' => 404]);
	}

	private static function active($c) {
		return in_array($c['status'], NBS_Entities::ACTIVE['colony'], true);
	}

	public static function move($org_id, $colony_id, $apiary_id, $date, $note) {
		$c = self::colony($org_id, $colony_id);
		if (is_wp_error($c)) {
			return $c;
		}
		$apiary_id = NBS_Repo::is_uuid($apiary_id) ? strtolower($apiary_id) : null;
		if ($apiary_id && !NBS_Entities::get($org_id, 'apiary', $apiary_id)) {
			return new WP_Error('nbs_404', 'Bigården finns inte.', ['status' => 404]);
		}
		if ($apiary_id === $c['apiary_id']) {
			return $c;
		}
		NBS_Entities::patch($org_id, 'colony', $colony_id, ['apiary_id' => $apiary_id]);
		// Kupan står där samhället står.
		if ($c['hive_id']) {
			NBS_Entities::patch($org_id, 'hive', $c['hive_id'], ['apiary_id' => $apiary_id]);
		}
		NBS_Events::add($org_id, 'flytt', ['colony_id' => $colony_id, 'queen_id' => $c['queen_id'], 'apiary_id' => $apiary_id, 'from_id' => $c['apiary_id']], $date, $note);
		return NBS_Entities::get($org_id, 'colony', $colony_id);
	}

	/** Fel om kupan inte finns eller redan används av ett annat aktivt samhälle. */
	public static function hive_conflict($org_id, $hive_id, $colony_id = '') {
		global $wpdb;
		if (!$hive_id) {
			return null;
		}
		$hive = NBS_Entities::get($org_id, 'hive', $hive_id);
		if (!$hive) {
			return new WP_Error('nbs_404', 'Kupan finns inte.', ['status' => 404]);
		}
		$active = "'" . implode("','", NBS_Entities::ACTIVE['colony']) . "'";
		$other  = $wpdb->get_var($wpdb->prepare('SELECT code FROM ' . NBS_Entities::table('colony') . " WHERE org_id = %s AND hive_id = %s AND id <> %s AND status IN ($active)", $org_id, $hive_id, (string) $colony_id)); // phpcs:ignore
		return $other ? new WP_Error('nbs_hive', sprintf('Kupa %s används redan av samhälle %s.', $hive['label'], $other), ['status' => 400]) : null;
	}

	public static function change_hive($org_id, $colony_id, $hive_id, $date, $note) {
		$c = self::colony($org_id, $colony_id);
		if (is_wp_error($c)) {
			return $c;
		}
		$hive_id = NBS_Repo::is_uuid($hive_id) ? strtolower($hive_id) : null;
		if ($hive_id === $c['hive_id']) {
			return $c;
		}
		$err = self::hive_conflict($org_id, $hive_id, $colony_id);
		if ($err) {
			return $err;
		}
		NBS_Entities::patch($org_id, 'colony', $colony_id, ['hive_id' => $hive_id]);
		if ($hive_id && $c['apiary_id']) {
			NBS_Entities::patch($org_id, 'hive', $hive_id, ['apiary_id' => $c['apiary_id']]);
		}
		NBS_Events::add($org_id, 'kupbyte', ['colony_id' => $colony_id, 'apiary_id' => $c['apiary_id'], 'data' => ['from' => $c['hive_id'], 'to' => $hive_id]], $date, $note);
		return NBS_Entities::get($org_id, 'colony', $colony_id);
	}

	/**
	 * Sätter drottning i ett samhälle. Den gamla drottningen får $old_status (t.ex.
	 * ersatt, död, såld). Sitter den nya drottningen i ett annat samhälle flyttas hon.
	 * $queen_id = null gör samhället drottninglöst.
	 */
	public static function set_queen($org_id, $colony_id, $queen_id, $date, $old_status, $note) {
		$c = self::colony($org_id, $colony_id);
		if (is_wp_error($c)) {
			return $c;
		}
		$queen_id = NBS_Repo::is_uuid($queen_id) ? strtolower($queen_id) : null;
		$old      = $c['queen_id'];
		if ($queen_id === $old) {
			return $c;
		}
		$new = null;
		if ($queen_id) {
			$new = NBS_Entities::get($org_id, 'queen', $queen_id);
			if (!$new) {
				return new WP_Error('nbs_404', 'Drottningen finns inte.', ['status' => 404]);
			}
			// Drottningen sitter i ett annat samhälle: ta ut henne därifrån.
			if ($new['colony_id'] && $new['colony_id'] !== $colony_id) {
				$from = NBS_Entities::get($org_id, 'colony', $new['colony_id']);
				if ($from && $from['queen_id'] === $queen_id) {
					NBS_Entities::patch($org_id, 'colony', $from['id'], ['queen_id' => null]);
					NBS_Events::add($org_id, 'drottning_ut', ['colony_id' => $from['id'], 'queen_id' => $queen_id, 'apiary_id' => $from['apiary_id'], 'other_id' => $colony_id, 'data' => ['moved' => true]], $date, $note);
				}
			}
		}
		if ($old) {
			$q   = NBS_Entities::get($org_id, 'queen', $old);
			$set = ['colony_id' => null];
			if ($q && in_array($old_status, NBS_Entities::ENUMS['queen'], true) && in_array($q['status'], NBS_Entities::ACTIVE['queen'], true)) {
				$set['status'] = $old_status;
			}
			NBS_Entities::patch($org_id, 'queen', $old, $set);
			NBS_Events::add($org_id, 'drottning_ut', ['colony_id' => $colony_id, 'queen_id' => $old, 'apiary_id' => $c['apiary_id'], 'other_id' => $queen_id, 'data' => ['status' => $set['status'] ?? null]], $date, $note);
		}
		if ($new) {
			NBS_Entities::patch($org_id, 'queen', $queen_id, ['colony_id' => $colony_id]);
			NBS_Events::add($org_id, 'drottning_in', ['colony_id' => $colony_id, 'queen_id' => $queen_id, 'apiary_id' => $c['apiary_id'], 'other_id' => $old], $date, $note);
		}
		NBS_Entities::patch($org_id, 'colony', $colony_id, ['queen_id' => $queen_id]);
		return NBS_Entities::get($org_id, 'colony', $colony_id);
	}

	public static function set_status($org_id, $colony_id, $status, $date, $note) {
		$c = self::colony($org_id, $colony_id);
		if (is_wp_error($c)) {
			return $c;
		}
		if (!in_array($status, NBS_Entities::ENUMS['colony'], true) || $status === $c['status']) {
			return $c;
		}
		$set = ['status' => $status];
		if (!in_array($status, NBS_Entities::ACTIVE['colony'], true)) {
			$set['ended'] = $date;
		} elseif (!self::active($c)) {
			$set['ended'] = null; // Återupplivat, t.ex. felregistrerat som dött.
		}
		NBS_Entities::patch($org_id, 'colony', $colony_id, $set);
		NBS_Events::add($org_id, 'status', ['colony_id' => $colony_id, 'apiary_id' => $c['apiary_id'], 'data' => ['from' => $c['status'], 'to' => $status]], $date, $note);
		return NBS_Entities::get($org_id, 'colony', $colony_id);
	}

	/** Dött eller sålt samhälle. Drottningen får samma öde om inget annat anges. */
	public static function close($org_id, $colony_id, $status, $queen_status, $date, $note) {
		$c = self::colony($org_id, $colony_id);
		if (is_wp_error($c)) {
			return $c;
		}
		if (!in_array($status, ['dod', 'sald'], true)) {
			return new WP_Error('nbs_status', 'Välj död eller såld.', ['status' => 400]);
		}
		if (!self::active($c)) {
			return new WP_Error('nbs_status', 'Samhället är redan avslutat.', ['status' => 400]);
		}
		NBS_Entities::patch($org_id, 'colony', $colony_id, ['status' => $status, 'ended' => $date]);
		NBS_Events::add($org_id, 'avslutad', ['colony_id' => $colony_id, 'queen_id' => $c['queen_id'], 'apiary_id' => $c['apiary_id'], 'data' => ['from' => $c['status'], 'to' => $status]], $date, $note);
		if ($c['queen_id'] && in_array($queen_status, NBS_Entities::ENUMS['queen'], true)) {
			NBS_Entities::patch($org_id, 'queen', $c['queen_id'], ['status' => $queen_status]);
		}
		return NBS_Entities::get($org_id, 'colony', $colony_id);
	}

	/**
	 * Delning: ett nytt samhälle (avläggare, Samuel, parningskupa) bildas ur $colony_id.
	 * $queen = none (drottninglöst/cell), move (moderns drottning följer med, som vid
	 * Samuel) eller new (ny drottning registreras i $new_queen).
	 */
	public static function split($org_id, $colony_id, $args, $date, $note) {
		$c = self::colony($org_id, $colony_id);
		if (is_wp_error($c)) {
			return $c;
		}
		if (!self::active($c)) {
			return new WP_Error('nbs_status', 'Ett avslutat samhälle kan inte delas.', ['status' => 400]);
		}
		$status = in_array($args['status'] ?? '', ['avlaggare', 'samuel', 'parning', 'produktion'], true) ? $args['status'] : 'avlaggare';
		$child  = NBS_Entities::save($org_id, 'colony', [
			'code'      => $args['code'] ?? '',
			'status'    => $status,
			'apiary_id' => array_key_exists('apiary_id', $args) ? $args['apiary_id'] : $c['apiary_id'],
			'parent_id' => $colony_id,
			'strength'  => $args['strength'] ?? null,
			'started'   => $date,
			'data'      => [],
		], null, ['internal' => true, 'events' => false, 'date' => $date]);
		if (is_wp_error($child)) {
			return $child;
		}
		NBS_Events::add($org_id, 'delning', ['colony_id' => $colony_id, 'apiary_id' => $c['apiary_id'], 'other_id' => $child['id'], 'data' => ['status' => $status]], $date, $note);
		NBS_Events::add($org_id, 'bildad', ['colony_id' => $child['id'], 'apiary_id' => $child['apiary_id'], 'other_id' => $colony_id, 'data' => ['status' => $status]], $date, $note);
		if (!empty($args['hive_id'])) {
			$r = self::change_hive($org_id, $child['id'], $args['hive_id'], $date, '');
			if (is_wp_error($r)) {
				return $r;
			}
		}
		$queen = $args['queen'] ?? 'none';
		if ($queen === 'move' && $c['queen_id']) {
			self::set_queen($org_id, $child['id'], $c['queen_id'], $date, null, '');
		} elseif ($queen === 'new') {
			$q = self::new_queen($org_id, (array) ($args['new_queen'] ?? []), $date);
			if (is_wp_error($q)) {
				return $q;
			}
			self::set_queen($org_id, $child['id'], $q['id'], $date, null, '');
		}
		return ['colony' => NBS_Entities::get($org_id, 'colony', $colony_id), 'child' => NBS_Entities::get($org_id, 'colony', $child['id'])];
	}

	/**
	 * Sammanslagning: $colony_id slås ihop med $into_id och upphör. $keep anger vilken
	 * drottning som blir kvar (this = den från samhället som upphör, into = mottagarens).
	 */
	public static function merge($org_id, $colony_id, $into_id, $keep, $other_status, $date, $note) {
		$c    = self::colony($org_id, $colony_id);
		$into = self::colony($org_id, $into_id);
		if (is_wp_error($c) || is_wp_error($into)) {
			return is_wp_error($c) ? $c : $into;
		}
		if ($colony_id === $into_id) {
			return new WP_Error('nbs_merge', 'Välj ett annat samhälle att slå ihop med.', ['status' => 400]);
		}
		if (!self::active($c) || !self::active($into)) {
			return new WP_Error('nbs_status', 'Båda samhällena måste vara aktiva.', ['status' => 400]);
		}
		$other_status = in_array($other_status, NBS_Entities::ENUMS['queen'], true) ? $other_status : 'ersatt';
		if ($keep === 'this' && $c['queen_id']) {
			self::set_queen($org_id, $into_id, $c['queen_id'], $date, $other_status, '');
		} elseif ($c['queen_id']) {
			$q = NBS_Entities::get($org_id, 'queen', $c['queen_id']);
			NBS_Entities::patch($org_id, 'queen', $c['queen_id'], ['colony_id' => null] + ($q && in_array($q['status'], NBS_Entities::ACTIVE['queen'], true) ? ['status' => $other_status] : []));
			NBS_Events::add($org_id, 'drottning_ut', ['colony_id' => $colony_id, 'queen_id' => $c['queen_id'], 'apiary_id' => $c['apiary_id'], 'data' => ['status' => $other_status]], $date, '');
			NBS_Entities::patch($org_id, 'colony', $colony_id, ['queen_id' => null]);
		}
		NBS_Entities::patch($org_id, 'colony', $colony_id, ['status' => 'sammanslagen', 'ended' => $date]);
		NBS_Events::add($org_id, 'sammanslagning', ['colony_id' => $colony_id, 'apiary_id' => $c['apiary_id'], 'other_id' => $into_id], $date, $note);
		NBS_Events::add($org_id, 'forstarkt', ['colony_id' => $into_id, 'apiary_id' => $into['apiary_id'], 'other_id' => $colony_id], $date, $note);
		return ['colony' => NBS_Entities::get($org_id, 'colony', $colony_id), 'into' => NBS_Entities::get($org_id, 'colony', $into_id)];
	}

	public static function new_queen($org_id, $data, $date) {
		$data['status'] = $data['status'] ?? 'oparad';
		if (empty($data['year'])) {
			$data['year'] = (int) substr($date, 0, 4);
		}
		unset($data['colony_id']);
		return NBS_Entities::save($org_id, 'queen', $data, null, ['date' => $date]);
	}

	/** Föreslår nästa lediga kod: högsta talet + 1 med samma prefix som den senaste. */
	public static function next_code($org_id, $type) {
		global $wpdb;
		$col  = NBS_Entities::TYPES[$type]['unique'];
		$t    = NBS_Entities::table($type);
		// Senaste koden som slutar på ett tal styr formatet (så att "1A" inte ger "1A-1").
		$recent = $wpdb->get_col($wpdb->prepare("SELECT $col FROM $t WHERE org_id = %s ORDER BY created_at DESC LIMIT 50", $org_id)); // phpcs:ignore
		$m      = null;
		foreach ($recent as $code) {
			if (preg_match('/^(.*?)(\d+)$/', (string) $code, $m)) {
				break;
			}
			$m = null;
		}
		if (!$m) {
			$m = $type === 'queen' ? [null, gmdate('y') . '-', '000'] : [null, '', '0'];
		}
		$prefix = $m[1];
		$like   = $wpdb->esc_like($prefix) . '%';
		$codes  = $wpdb->get_col($wpdb->prepare("SELECT $col FROM $t WHERE org_id = %s AND $col LIKE %s", $org_id, $like)); // phpcs:ignore
		$max    = 0;
		foreach ($codes as $code) {
			if (preg_match('/^' . preg_quote($prefix, '/') . '(\d+)$/', $code, $mm)) {
				$max = max($max, (int) $mm[1]);
			}
		}
		return $prefix . str_pad((string) ($max + 1), strlen($m[2]), '0', STR_PAD_LEFT);
	}
}
