<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * Registren i fas 1: bigårdar, kupor, samhällen och drottningar. Varje typ har fasta
 * kolumner (för kopplingar, filter och index) och egna fält som användaren definierar
 * själv – värdena i de egna fälten sparas i kolumnen data.
 *
 * Ändringar som är historik (flytt, drottningbyte, kupbyte, status) loggas som händelser
 * i NBS_Events, även när de görs via det vanliga formuläret.
 */
class NBS_Entities {

	/**
	 * Kolumntyper: text! (obligatorisk text), text, code, textarea, uuid, int, lat, lng,
	 * date, bool, enum:<namn>.
	 */
	const TYPES = [
		'apiary' => [
			'table' => 'apiaries',
			'title' => 'name',
			'label' => 'Bigården',
			'cols'  => [
				'name'       => 'text!',
				'code'       => 'code',
				'type_id'    => 'uuid',
				'route_id'   => 'uuid',
				'capacity'   => 'int',
				'lat'        => 'lat',
				'lng'        => 'lng',
				'location'   => 'text',
				'registered' => 'date',
				'active'     => 'bool',
				'sort'       => 'int',
				'notes'      => 'textarea',
			],
			'index' => ['route_id'],
		],
		'hive'   => [
			'table'  => 'hives',
			'title'  => 'label',
			'label'  => 'Kupan',
			'unique' => 'label',
			'cols'   => [
				'label'     => 'text!',
				'system_id' => 'uuid',
				'active'    => 'bool',
				'notes'     => 'textarea',
			],
		],
		'colony' => [
			'table'  => 'colonies',
			'title'  => 'code',
			'label'  => 'Samhället',
			'unique' => 'code',
			'cols'   => [
				'code'      => 'text!',
				'status'    => 'enum:colony',
				'apiary_id' => 'uuid',
				'hive_id'   => 'uuid',
				'queen_id'  => 'uuid',
				'parent_id' => 'uuid',
				'strength'  => 'int',
				'started'   => 'date',
				'ended'     => 'date',
				'notes'     => 'textarea',
			],
			'index'  => ['apiary_id', 'queen_id', 'hive_id'],
		],
		'queen'  => [
			'table'  => 'queens',
			'title'  => 'code',
			'label'  => 'Drottningen',
			'unique' => 'code',
			'cols'   => [
				'code'         => 'text!',
				'year'         => 'int',
				'status'       => 'enum:queen',
				'colony_id'    => 'uuid',
				'line_id'      => 'uuid',
				'mother_id'    => 'uuid',
				'mating'       => 'enum:mating',
				'mating_place' => 'text',
				'marked'       => 'bool',
				'clipped'      => 'bool',
				'notes'        => 'textarea',
			],
			'index'  => ['colony_id', 'mother_id'],
		],
	];

	/** Fasta värden som styr logik. Det första värdet är standard. */
	const ENUMS = [
		'colony' => ['produktion', 'avlaggare', 'samuel', 'parning', 'dod', 'sald', 'sammanslagen'],
		'queen'  => ['parad', 'oparad', 'ersatt', 'dod', 'sald', 'forsvunnen'],
		'mating' => ['', 'fri', 'station', 'moonshine', 'instrumentell'],
	];

	/** Status som betyder att samhället/drottningen är aktiv. */
	const ACTIVE = [
		'colony' => ['produktion', 'avlaggare', 'samuel', 'parning'],
		'queen'  => ['parad', 'oparad'],
	];

	/** Kolumner som bara ändras via operationerna, inte via formuläret. */
	const LOCKED = [
		'colony' => ['parent_id', 'ended'],
		'queen'  => ['colony_id'],
	];

	public static function sql_type($kind) {
		switch (strtok($kind, ':')) {
			case 'text!':
				return 'varchar(190) NOT NULL';
			case 'text':
				return 'varchar(190) NULL';
			case 'code':
				return 'varchar(64) NULL';
			case 'textarea':
				return 'text NULL';
			case 'uuid':
				return 'char(36) NULL';
			case 'int':
				return 'int(11) NULL';
			case 'lat':
			case 'lng':
				return 'decimal(9,6) NULL';
			case 'date':
				return 'date NULL';
			case 'bool':
				return 'tinyint(1) NOT NULL DEFAULT 0';
			case 'enum':
				return 'varchar(20) NULL';
		}
		return 'varchar(190) NULL';
	}

	public static function def($type) {
		return self::TYPES[$type] ?? null;
	}

	public static function table($type) {
		return NBS_DB::table(self::TYPES[$type]['table']);
	}

	// ------------------------------------------------------------ Egna fält per typ

	public static function fields($org_id, $type) {
		$s = NBS_Auth::org_settings($org_id);
		return $s['fields'][$type] ?? [];
	}

	public static function all_fields($org_id) {
		$out = [];
		foreach (array_keys(self::TYPES) as $type) {
			$out[$type] = self::fields($org_id, $type);
		}
		return $out;
	}

	public static function save_fields($org_id, $type, $fields) {
		if (!self::def($type)) {
			return new WP_Error('nbs_type', 'Okänd typ.', ['status' => 400]);
		}
		$clean = NBS_Lists::sanitize_fields($fields);
		// Egna fält får inte krocka med de fasta kolumnerna.
		foreach ($clean as &$f) {
			if (isset(self::TYPES[$type]['cols'][$f['key']]) || in_array($f['key'], ['id', 'data'], true)) {
				$f['key'] = 'x_' . $f['key'];
			}
		}
		unset($f);
		$s                   = NBS_Auth::org_settings($org_id);
		$s['fields'][$type]  = $clean;
		NBS_Auth::save_org_settings($org_id, $s);
		NBS_Repo::audit('fields', $org_id, 'update', ['type' => $type, 'fields' => wp_list_pluck($clean, 'label')]);
		return $clean;
	}

	// ------------------------------------------------------------ Läsning

	private static function cast($type, $r) {
		if (!$r) {
			return null;
		}
		$out = ['id' => $r['id']];
		foreach (self::TYPES[$type]['cols'] as $col => $kind) {
			$v = $r[$col];
			switch (strtok($kind, ':')) {
				case 'int':
					$v = $v === null ? null : (int) $v;
					break;
				case 'lat':
				case 'lng':
					$v = $v === null ? null : (float) $v;
					break;
				case 'bool':
					$v = (bool) $v;
					break;
				default:
					$v = $v === null ? null : (string) $v;
			}
			$out[$col] = $v;
		}
		$out['data']       = (object) NBS_Repo::unjson($r['data']);
		$out['created_at'] = $r['created_at'];
		$out['updated_at'] = $r['updated_at'];
		return $out;
	}

	public static function get($org_id, $type, $id) {
		global $wpdb;
		if (!self::def($type) || !NBS_Repo::is_uuid($id)) {
			return null;
		}
		$r = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::table($type) . ' WHERE org_id = %s AND id = %s', $org_id, $id), ARRAY_A);
		return self::cast($type, $r);
	}

	public static function all($org_id, $type) {
		global $wpdb;
		$order = $type === 'apiary' ? 'sort, name' : self::TYPES[$type]['title'];
		$rows  = $wpdb->get_results($wpdb->prepare('SELECT * FROM ' . self::table($type) . " WHERE org_id = %s ORDER BY $order", $org_id), ARRAY_A); // phpcs:ignore
		return array_map(function ($r) use ($type) {
			return self::cast($type, $r);
		}, $rows);
	}

	/** Märkfärg för ett årtal enligt listan "Märkfärger" (slutsiffror). */
	public static function mark_colors($org_id) {
		static $cache = [];
		if (isset($cache[$org_id])) {
			return $cache[$org_id];
		}
		$out  = [];
		$list = NBS_Lists::get_by_key($org_id, 'markfarger');
		if ($list) {
			foreach (NBS_Lists::items($org_id, $list['id']) as $it) {
				$digits = (string) ($it['data']->slutsiffror ?? '');
				foreach (preg_split('/\D+/', $digits, -1, PREG_SPLIT_NO_EMPTY) as $d) {
					$out[(int) $d % 10] = ['name' => $it['name'], 'color' => $it['color'] ?: '#999999'];
				}
			}
		}
		return $cache[$org_id] = $out;
	}

	/** Hela registret i ett anrop (en biodlare har några hundra rader, inte miljoner). */
	public static function register($org_id) {
		$marks  = self::mark_colors($org_id);
		$queens = array_map(function ($q) use ($marks) {
			$q['mark'] = $q['year'] !== null ? ($marks[$q['year'] % 10] ?? null) : null;
			return $q;
		}, self::all($org_id, 'queen'));
		return [
			'apiaries' => self::all($org_id, 'apiary'),
			'hives'    => self::all($org_id, 'hive'),
			'colonies' => self::all($org_id, 'colony'),
			'queens'   => $queens,
			'fields'   => self::all_fields($org_id),
			'marks'    => (object) $marks,
		];
	}

	// ------------------------------------------------------------ Skrivning

	/** Rensar de fasta kolumnerna som finns i $data. Returnerar [värden, fel]. */
	private static function sanitize($type, $data, $creating) {
		$out    = [];
		$errors = [];
		foreach (self::TYPES[$type]['cols'] as $col => $kind) {
			if (!array_key_exists($col, $data)) {
				continue;
			}
			$v = $data[$col];
			switch (strtok($kind, ':')) {
				case 'text!':
					$v = sanitize_text_field((string) $v);
					if ($v === '') {
						$errors[] = 'Namn/kod måste fyllas i.';
					}
					break;
				case 'text':
				case 'code':
					$v = sanitize_text_field((string) $v);
					$v = $v === '' ? null : mb_substr($v, 0, $kind === 'code' ? 64 : 190);
					break;
				case 'textarea':
					$v = sanitize_textarea_field((string) $v);
					break;
				case 'uuid':
					$v = NBS_Repo::is_uuid($v) ? strtolower($v) : null;
					break;
				case 'int':
					$v = ($v === null || $v === '' || !is_numeric($v)) ? null : (int) $v;
					break;
				case 'lat':
				case 'lng':
					$v = ($v === null || $v === '' || !is_numeric(str_replace(',', '.', (string) $v))) ? null : round((float) str_replace(',', '.', (string) $v), 6);
					$max = $kind === 'lat' ? 90 : 180;
					if ($v !== null && abs($v) > $max) {
						$errors[] = 'Ogiltig position.';
					}
					break;
				case 'date':
					$v = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $v) ? $v : null;
					break;
				case 'bool':
					$v = $v ? 1 : 0;
					break;
				case 'enum':
					$enum = self::ENUMS[substr($kind, 5)];
					$v    = in_array((string) $v, $enum, true) ? (string) $v : $enum[0];
					break;
			}
			$out[$col] = $v;
		}
		return [$out, $errors];
	}

	private static function defaults($type) {
		$d = [];
		foreach (self::TYPES[$type]['cols'] as $col => $kind) {
			if ($kind === 'bool') {
				$d[$col] = $col === 'active' ? 1 : 0;
			} elseif (strpos($kind, 'enum:') === 0) {
				$d[$col] = self::ENUMS[substr($kind, 5)][0];
			}
		}
		return $d;
	}

	private static function unique_ok($org_id, $type, $value, $except_id = null) {
		global $wpdb;
		$col = self::TYPES[$type]['unique'] ?? null;
		if (!$col || $value === null) {
			return true;
		}
		$sql = $wpdb->prepare('SELECT id FROM ' . self::table($type) . " WHERE org_id = %s AND $col = %s", $org_id, $value); // phpcs:ignore
		$hit = $wpdb->get_var($sql . ($except_id ? $wpdb->prepare(' AND id <> %s', $except_id) : ''));
		return !$hit;
	}

	/**
	 * Skapar eller uppdaterar. $opts['date'] = datum för händelser som uppstår,
	 * $opts['events'] = false för att inte logga (används av operationerna).
	 */
	public static function save($org_id, $type, $data, $id = null, $opts = []) {
		global $wpdb;
		$def = self::def($type);
		if (!$def) {
			return new WP_Error('nbs_type', 'Okänd typ.', ['status' => 400]);
		}
		$before = $id ? self::get($org_id, $type, $id) : null;
		if ($id && !$before) {
			return new WP_Error('nbs_404', $def['label'] . ' finns inte.', ['status' => 404]);
		}
		if ($before && empty($opts['internal'])) {
			foreach (self::LOCKED[$type] ?? [] as $col) {
				unset($data[$col]);
			}
		}
		list($set, $errors) = self::sanitize($type, $data, !$before);
		if (!$before && !isset($set[$def['title']])) {
			$errors[] = 'Namn/kod måste fyllas i.';
		}
		if (array_key_exists('data', $data)) {
			$fields = self::fields($org_id, $type);
			$vals   = NBS_Lists::sanitize_values($fields, (array) $data['data'], $errors);
			// Värden i fält som har tagits bort ur definitionen sparas kvar tills vidare.
			$keep        = $before ? array_diff_key((array) $before['data'], array_flip(wp_list_pluck($fields, 'key'))) : [];
			$set['data'] = NBS_Repo::json((object) ($vals + $keep));
		}
		if ($errors) {
			return new WP_Error('nbs_invalid', implode(' ', array_unique($errors)), ['status' => 400]);
		}
		$ucol = $def['unique'] ?? null;
		if ($ucol && isset($set[$ucol]) && !self::unique_ok($org_id, $type, $set[$ucol], $id)) {
			return new WP_Error('nbs_unique', sprintf('Det finns redan en post med "%s".', $set[$ucol]), ['status' => 400]);
		}

		$now  = NBS_DB::now();
		$user = get_current_user_id() ?: null;
		$set['updated_at'] = $now;
		$set['updated_by'] = $user;

		if ($before) {
			// Kopplingar med historik tas om hand separat.
			$hist = [];
			foreach (['apiary_id', 'queen_id', 'hive_id', 'status'] as $col) {
				if ($type === 'colony' && array_key_exists($col, $set) && $set[$col] !== $before[$col] && empty($opts['internal'])) {
					$hist[$col] = $set[$col];
					unset($set[$col]);
				}
			}
			if ($type === 'queen' && isset($set['status']) && $set['status'] !== $before['status'] && empty($opts['internal'])) {
				$hist['queen_status'] = $set['status'];
			}
			$wpdb->update(self::table($type), $set, ['id' => $id, 'org_id' => $org_id]);
			$date = $opts['date'] ?? current_time('Y-m-d');
			if ($type === 'colony' && $hist) {
				$ops = [
					'apiary_id' => function ($v) use ($org_id, $id, $date) { return NBS_Ops::move($org_id, $id, $v, $date, ''); },
					'hive_id'   => function ($v) use ($org_id, $id, $date) { return NBS_Ops::change_hive($org_id, $id, $v, $date, ''); },
					'queen_id'  => function ($v) use ($org_id, $id, $date) { return NBS_Ops::set_queen($org_id, $id, $v, $date, 'ersatt', ''); },
					'status'    => function ($v) use ($org_id, $id, $date) { return NBS_Ops::set_status($org_id, $id, $v, $date, ''); },
				];
				foreach ($ops as $col => $op) {
					if (array_key_exists($col, $hist)) {
						$r = $op($hist[$col]);
						if (is_wp_error($r)) {
							return $r;
						}
					}
				}
			}
			if (isset($hist['queen_status'])) {
				NBS_Events::add($org_id, 'status', ['queen_id' => $id, 'data' => ['from' => $before['status'], 'to' => $hist['queen_status']]], $date);
			}
			$after = self::get($org_id, $type, $id);
			$diff  = NBS_Repo::diff(self::audit_view($before), self::audit_view($after));
			if ($diff) {
				NBS_Repo::audit($type, $id, 'update', $diff);
			}
			return $after;
		}

		if ($type === 'colony' && !empty($set['hive_id'])) {
			$err = NBS_Ops::hive_conflict($org_id, $set['hive_id']);
			if ($err) {
				return $err;
			}
		}
		$id  = NBS_Repo::id($data['id'] ?? null);
		$row = array_merge(self::defaults($type), $set, [
			'id'         => $id,
			'org_id'     => $org_id,
			'created_at' => $now,
			'created_by' => $user,
		]);
		if (!isset($row['data'])) {
			$row['data'] = '{}';
		}
		// Drottningen kopplas med en operation så att den släpps från ett annat samhälle.
		$queen = $type === 'colony' ? ($row['queen_id'] ?? null) : null;
		if ($queen) {
			$row['queen_id'] = null;
		}
		if ($type === 'colony' && empty($row['started'])) {
			$row['started'] = $opts['date'] ?? current_time('Y-m-d');
		}
		$wpdb->insert(self::table($type), $row);
		NBS_Repo::audit($type, $id, 'create', [$def['title'] => $row[$def['title']]]);
		if (!isset($opts['events']) || $opts['events']) {
			$date = $type === 'colony' ? $row['started'] : ($opts['date'] ?? current_time('Y-m-d'));
			if ($type === 'colony') {
				NBS_Events::add($org_id, 'skapad', ['colony_id' => $id, 'apiary_id' => $row['apiary_id'] ?? null, 'other_id' => $row['parent_id'] ?? null, 'data' => ['status' => $row['status']]], $date);
			} elseif ($type === 'queen') {
				NBS_Events::add($org_id, 'skapad', ['queen_id' => $id, 'other_id' => $row['mother_id'] ?? null], $date);
			}
		}
		if ($queen) {
			NBS_Ops::set_queen($org_id, $id, $queen, $row['started'], 'ersatt', '');
		}
		return self::get($org_id, $type, $id);
	}

	private static function audit_view($row) {
		$r = (array) $row;
		unset($r['created_at'], $r['updated_at']);
		$r['data'] = (array) $r['data'];
		return $r;
	}

	/** Direkt uppdatering av kolumner utan historik (används av operationerna). */
	public static function patch($org_id, $type, $id, $set) {
		global $wpdb;
		$set['updated_at'] = NBS_DB::now();
		$set['updated_by'] = get_current_user_id() ?: null;
		return $wpdb->update(self::table($type), $set, ['id' => $id, 'org_id' => $org_id]);
	}

	public static function delete($org_id, $type, $id) {
		global $wpdb;
		$row = self::get($org_id, $type, $id);
		if (!$row) {
			return new WP_Error('nbs_404', 'Posten finns inte.', ['status' => 404]);
		}
		$colonies = self::table('colony');
		if ($type === 'apiary') {
			$n = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM $colonies WHERE org_id = %s AND apiary_id = %s", $org_id, $id)); // phpcs:ignore
			if ($n) {
				return new WP_Error('nbs_in_use', sprintf('Bigården har %d samhällen (även avslutade) kopplade till sig. Flytta dem eller gör bigården inaktiv i stället.', $n), ['status' => 400]);
			}
		}
		if ($type === 'hive') {
			$wpdb->update($colonies, ['hive_id' => null], ['org_id' => $org_id, 'hive_id' => $id]);
		}
		if ($type === 'queen') {
			$wpdb->update($colonies, ['queen_id' => null], ['org_id' => $org_id, 'queen_id' => $id]);
			$wpdb->delete(NBS_DB::table('events'), ['org_id' => $org_id, 'queen_id' => $id, 'colony_id' => null]);
		}
		if ($type === 'colony') {
			$wpdb->update(self::table('queen'), ['colony_id' => null], ['org_id' => $org_id, 'colony_id' => $id]);
			$wpdb->delete(NBS_DB::table('events'), ['org_id' => $org_id, 'colony_id' => $id]);
		}
		$wpdb->delete(self::table($type), ['id' => $id, 'org_id' => $org_id]);
		NBS_Repo::audit($type, $id, 'delete', [self::TYPES[$type]['title'] => $row[self::TYPES[$type]['title']]]);
		return true;
	}
}
