<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * Skötselkort och besök (fas 3).
 *
 * Ett skötselkort är en mall som användaren bygger själv: syfte, rutinsteg, checklista,
 * material (kopplat till lagret: mängd per samhälle, per bigård eller per besök) och
 * egna kupkontrollfält. Ett besök = ett kort i en bigård ett visst datum. Under besöket
 * fylls kupkontrollen i per samhälle. När besöket avslutas:
 *   - materialet bokas i lagret (förbrukning per samhälle eller till kuporna),
 *   - varje kontrollerat samhälle får en händelse i sin historik,
 *   - fält som är kopplade till styrka uppdaterar samhällets styrka.
 * Ett avslutat besök kan öppnas igen; då ångras lagerbokningar och händelser.
 */
class NBS_Visits {

	const STATUS = ['planned', 'ongoing', 'done'];
	const PER    = ['colony', 'apiary', 'visit'];

	private static function t($n) {
		return NBS_DB::table($n);
	}

	// ------------------------------------------------------------ Skötselkort

	/**
	 * Kortets behandlingar: [{id, kill, broodless}]. Ett ensamt objekt (äldre format) blir en lista.
	 * broodless = samhället är yngelfritt vid behandlingen (t.ex. oxalsyra i det nya Samuelsamhället),
	 * så en behandling som annars bara når kvalster på bina får full verkan i modellen.
	 */
	public static function card_treatments($t) {
		if (!is_array($t)) {
			return [];
		}
		if (isset($t['id'])) {
			$t = [$t];
		}
		$out = [];
		foreach ($t as $x) {
			if (!is_array($x) || !NBS_Repo::is_uuid($x['id'] ?? '')) {
				continue;
			}
			$out[] = [
				'id'        => strtolower($x['id']),
				'kill'      => isset($x['kill']) && is_numeric($x['kill']) ? max(0, min(100, (float) $x['kill'])) : null,
				'broodless' => !empty($x['broodless']),
			];
		}
		return $out;
	}

	private static function cast_template($r) {
		return [
			'id'          => $r['id'],
			'name'        => $r['name'],
			'category_id' => $r['category_id'],
			'purpose'     => (string) $r['purpose'],
			'steps'       => NBS_Repo::unjson($r['steps']),
			'checklist'   => NBS_Repo::unjson($r['checklist']),
			'material'    => NBS_Repo::unjson($r['material']),
			'fields'      => NBS_Repo::unjson($r['fields']),
			'treatment'   => self::card_treatments(NBS_Repo::unjson($r['treatment'] ?? null, null)),
			'sort'        => (int) $r['sort'],
			'archived'    => (bool) $r['archived'],
			'visits'      => isset($r['visit_count']) ? (int) $r['visit_count'] : 0,
			'updated_at'  => $r['updated_at'],
		];
	}

	public static function templates($org_id) {
		global $wpdb;
		$t = self::t('templates');
		$v = self::t('visits');
		$rows = $wpdb->get_results($wpdb->prepare("SELECT x.*, (SELECT COUNT(*) FROM $v v WHERE v.template_id = x.id) AS visit_count FROM $t x WHERE x.org_id = %s ORDER BY x.sort, x.name", $org_id), ARRAY_A); // phpcs:ignore
		return array_map([__CLASS__, 'cast_template'], $rows);
	}

	public static function template($org_id, $id) {
		global $wpdb;
		$r = NBS_Repo::is_uuid($id) ? $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::t('templates') . ' WHERE org_id = %s AND id = %s', $org_id, $id), ARRAY_A) : null;
		return $r ? self::cast_template($r) : null;
	}

	private static function clean_template($d) {
		$steps = [];
		foreach ((array) ($d['steps'] ?? []) as $s) {
			$title = sanitize_text_field($s['title'] ?? '');
			$text  = sanitize_textarea_field($s['text'] ?? '');
			if ($title !== '' || $text !== '') {
				$steps[] = ['title' => $title, 'text' => $text];
			}
		}
		$check = array_values(array_filter(array_map('sanitize_text_field', (array) ($d['checklist'] ?? [])), 'strlen'));
		$mat   = [];
		foreach ((array) ($d['material'] ?? []) as $m) {
			$label = sanitize_text_field($m['label'] ?? '');
			$item  = NBS_Repo::is_uuid($m['item_id'] ?? '') ? strtolower($m['item_id']) : null;
			if ($label === '' && !$item) {
				continue;
			}
			$qty   = str_replace(',', '.', (string) ($m['qty'] ?? ''));
			$mat[] = [
				'item_id' => $item,
				'label'   => $label,
				'qty'     => is_numeric($qty) && (float) $qty > 0 ? (float) $qty : null,
				'per'     => in_array($m['per'] ?? '', self::PER, true) ? $m['per'] : 'colony',
				'kind'    => ($m['kind'] ?? '') === 'move' ? 'move' : 'consume',
			];
		}
		return [
			'name'        => sanitize_text_field($d['name'] ?? ''),
			'category_id' => NBS_Repo::is_uuid($d['category_id'] ?? '') ? strtolower($d['category_id']) : null,
			'purpose'     => sanitize_textarea_field($d['purpose'] ?? ''),
			'steps'       => NBS_Repo::json($steps),
			'checklist'   => NBS_Repo::json($check),
			'material'    => NBS_Repo::json($mat),
			'fields'      => NBS_Repo::json(NBS_Lists::sanitize_fields($d['fields'] ?? [])),
			// Kortet är en behandling: varje kontrollerat samhälle får behandlingen i Bihälsa.
			'treatment'   => ($ts = self::card_treatments($d['treatment'] ?? null)) ? NBS_Repo::json($ts) : null,
		];
	}

	public static function save_template($org_id, $d, $id = null) {
		global $wpdb;
		$row = self::clean_template($d);
		if ($row['name'] === '') {
			return new WP_Error('nbs_name', 'Skötselkortet behöver ett namn.', ['status' => 400]);
		}
		$row['updated_at'] = NBS_DB::now();
		if (isset($d['archived'])) {
			$row['archived'] = $d['archived'] ? 1 : 0;
		}
		if ($id) {
			if (!self::template($org_id, $id)) {
				return new WP_Error('nbs_404', 'Skötselkortet finns inte.', ['status' => 404]);
			}
			$wpdb->update(self::t('templates'), $row, ['id' => $id, 'org_id' => $org_id]);
			NBS_Repo::audit('template', $id, 'update', ['name' => $row['name']]);
			return self::template($org_id, $id);
		}
		$id  = NBS_Repo::id($d['id'] ?? null);
		$max = (int) $wpdb->get_var($wpdb->prepare('SELECT MAX(sort) FROM ' . self::t('templates') . ' WHERE org_id = %s', $org_id));
		$wpdb->insert(self::t('templates'), $row + [
			'id'         => $id,
			'org_id'     => $org_id,
			'sort'       => isset($d['sort']) ? (int) $d['sort'] : $max + 10,
			'created_at' => NBS_DB::now(),
			'created_by' => get_current_user_id() ?: null,
		]);
		if ($wpdb->last_error) {
			return new WP_Error('nbs_db', 'Skötselkortet kunde inte sparas: ' . $wpdb->last_error, ['status' => 500]);
		}
		NBS_Repo::audit('template', $id, 'create', ['name' => $row['name']]);
		return self::template($org_id, $id);
	}

	public static function delete_template($org_id, $id) {
		global $wpdb;
		$t = self::template($org_id, $id);
		if (!$t) {
			return new WP_Error('nbs_404', 'Skötselkortet finns inte.', ['status' => 404]);
		}
		if ($t['visits']) {
			return new WP_Error('nbs_in_use', sprintf('Kortet används i %d besök. Arkivera det i stället.', $t['visits']), ['status' => 400]);
		}
		$wpdb->delete(self::t('templates'), ['id' => $id, 'org_id' => $org_id]);
		NBS_Repo::audit('template', $id, 'delete', ['name' => $t['name']]);
		return true;
	}

	// ------------------------------------------------------------ Besök

	private static function cast_visit($r) {
		return [
			'id'            => $r['id'],
			'template_id'   => $r['template_id'],
			'apiary_id'     => $r['apiary_id'],
			'date'          => $r['visit_date'],
			'status'        => $r['status'],
			'start_time'    => (string) $r['start_time'],
			'end_time'      => (string) $r['end_time'],
			'checked'       => NBS_Repo::unjson($r['checked']),
			'material'      => NBS_Repo::unjson($r['material'], null),
			'result'        => (string) $r['result'],
			'deviation'     => (string) $r['deviation'],
			'followup'      => (bool) $r['followup'],
			'followup_date' => $r['followup_date'],
			'followup_done' => (bool) $r['followup_done'],
			'notes'         => (string) $r['notes'],
			'user'          => $r['user'] ?? '',
			'done_at'       => $r['done_at'],
			'inspected'     => isset($r['inspected']) ? (int) $r['inspected'] : null,
		];
	}

	public static function visits($org_id, $f = []) {
		global $wpdb;
		$v     = self::t('visits');
		$i     = self::t('inspections');
		$u     = $wpdb->users;
		$where = $wpdb->prepare('v.org_id = %s', $org_id);
		foreach (['apiary_id', 'template_id'] as $k) {
			if (!empty($f[$k]) && NBS_Repo::is_uuid($f[$k])) {
				$where .= $wpdb->prepare(" AND v.$k = %s", $f[$k]);
			}
		}
		if (!empty($f['status']) && in_array($f['status'], self::STATUS, true)) {
			$where .= $wpdb->prepare(' AND v.status = %s', $f['status']);
		}
		if (!empty($f['open'])) {
			$where .= " AND v.status <> 'done'";
		}
		if (!empty($f['followup'])) {
			$where .= ' AND v.followup = 1 AND v.followup_done = 0';
		}
		foreach (['since' => '>=', 'until' => '<='] as $k => $op) {
			if (!empty($f[$k]) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $f[$k])) {
				$where .= $wpdb->prepare(" AND v.visit_date $op %s", $f[$k]);
			}
		}
		$limit = max(1, min(500, (int) ($f['limit'] ?? 200)));
		$order = !empty($f['open']) ? 'v.visit_date ASC' : 'v.visit_date DESC';
		$rows  = $wpdb->get_results("SELECT v.*, u.display_name AS user, (SELECT COUNT(*) FROM $i i WHERE i.visit_id = v.id AND i.skipped = 0) AS inspected FROM $v v LEFT JOIN $u u ON u.ID = v.user_id WHERE $where ORDER BY $order, v.created_at LIMIT $limit", ARRAY_A); // phpcs:ignore
		return array_map([__CLASS__, 'cast_visit'], $rows);
	}

	/**
	 * Behandlingar som ligger i planerade och pågående besök (inte avslutade), så att de syns i
	 * Bihälsa och i varroamodellen innan besöket är gjort. Kortets behandling och förbrukade
	 * behandlingsmedel gäller alla samhällen; ja/nej-fält gäller där de kryssats i, eller alla om
	 * kupkontrollen inte är ifylld än (via = field).
	 */
	public static function planned_treatments($org_id, $since, $until) {
		$list  = NBS_Lists::get_by_key($org_id, 'behandling');
		$items = [];
		$by_m  = [];
		foreach ($list ? NBS_Lists::items($org_id, $list['id']) : [] as $it) {
			$items[$it['id']] = $it;
			if (!empty($it['data']->material)) {
				$by_m[$it['data']->material] = $it['id'];
			}
		}
		$out = [];
		foreach (self::visits($org_id, ['open' => 1, 'since' => $since, 'until' => $until, 'limit' => 500]) as $row) {
			$v   = self::visit($org_id, $row['id']);
			$tpl = $v['template'];
			if (!$tpl) {
				continue;
			}
			// Samhällena: de som kontrolleras i besöket, annars bigårdens aktiva samhällen.
			$filled = array_filter($v['inspections'], function ($i) {
				return !$i['skipped'];
			});
			$colonies = $filled ? array_values(array_column($filled, 'colony_id')) : array_values(array_column(array_filter(NBS_Entities::all($org_id, 'colony'), function ($c) use ($v) {
				return $c['apiary_id'] === $v['apiary_id'] && in_array($c['status'], NBS_Entities::ACTIVE['colony'], true);
			}), 'id'));
			$seen = []; // samma behandling på kortet och i ett fält räknas en gång (kortet går före)
			$add  = function ($t, $cols, $via, $kill = null, $broodless = false) use (&$out, &$seen, $items, $v, $tpl) {
				if (!isset($items[$t]) || !$cols || isset($seen[$t])) {
					return;
				}
				$seen[$t] = true;
				$k     = $kill ?? ($items[$t]['data']->avdodning ?? null);
				$out[] = ['source' => 'visit', 'visit_id' => $v['id'], 'date' => $v['date'], 'status' => $v['status'], 'template' => $tpl['name'], 'template_id' => $tpl['id'], 'apiary_id' => $v['apiary_id'], 'treatment_id' => $t, 'kill' => is_numeric($k) ? (float) $k : null, 'broodless' => (bool) $broodless, 'colony_ids' => array_values($cols), 'via' => $via];
			};
			foreach ($tpl['treatment'] as $ct) {
				$add($ct['id'], $colonies, 'card', $ct['kill'], $ct['broodless']);
			}
			foreach ($tpl['fields'] as $f) {
				if (strpos((string) ($f['maps'] ?? ''), 'treat:') !== 0) {
					continue;
				}
				$cols = $filled ? array_values(array_column(array_filter($filled, function ($i) use ($f) {
					return !empty(((array) $i['data'])[$f['key']]);
				}), 'colony_id')) : $colonies;
				$add(substr($f['maps'], 6), $cols, 'field');
			}
			foreach ((array) $tpl['material'] as $m) {
				if (!empty($m['item_id']) && isset($by_m[$m['item_id']])) {
					$add($by_m[$m['item_id']], $colonies, 'material');
				}
			}
		}
		return array_merge($out, self::plan_treatments($org_id, $since, $until, $items));
	}

	/**
	 * Driftplanens behandlingar: varje aktivitet med skötselkort ger kortets behandlingar (vecka-start)
	 * i bigårdarna aktiviteten gäller. Finns redan ett besök med samma kort i bigården runt de veckorna
	 * (planerat eller gjort) räknas besöket i stället.
	 */
	private static function plan_treatments($org_id, $since, $until, $items) {
		$year      = (int) substr($since, 0, 4);
		$templates = [];
		foreach (self::templates($org_id) as $t) {
			$templates[$t['id']] = $t;
		}
		$apiaries = array_filter(NBS_Entities::all($org_id, 'apiary'), function ($a) {
			return !empty($a['active']);
		});
		$active   = [];
		foreach (NBS_Entities::all($org_id, 'colony') as $c) {
			if (in_array($c['status'], NBS_Entities::ACTIVE['colony'], true) && $c['apiary_id']) {
				$active[$c['apiary_id']][] = $c['id'];
			}
		}
		$visits = self::visits($org_id, ['since' => ($year - 1) . '-12-01', 'until' => ($year + 1) . '-01-31', 'limit' => 500]);
		$out    = [];
		foreach (NBS_Entities::all($org_id, 'plan') as $p) {
			$tpl = $templates[$p['template_id'] ?? ''] ?? null;
			if ($p['kind'] !== 'activity' || !$tpl || !$tpl['treatment'] || !$p['week_start']) {
				continue;
			}
			$start = (new DateTime())->setISODate($year, (int) $p['week_start'])->format('Y-m-d');
			$end   = (new DateTime())->setISODate($year, (int) ($p['week_end'] ?: $p['week_start']), 7)->format('Y-m-d');
			if ($start < $since || $start > $until) {
				continue;
			}
			$from  = gmdate('Y-m-d', strtotime($start . ' -14 days'));
			$to    = gmdate('Y-m-d', strtotime($end . ' +14 days'));
			$scope = is_array($p['scope']) ? $p['scope'] : [];
			foreach ($apiaries as $a) {
				if (!self::in_scope($a, $scope) || empty($active[$a['id']])) {
					continue;
				}
				$has_visit = false;
				foreach ($visits as $v) {
					if ($v['apiary_id'] === $a['id'] && $v['template_id'] === $tpl['id'] && $v['date'] >= $from && $v['date'] <= $to) {
						$has_visit = true;
					}
				}
				if ($has_visit) {
					continue;
				}
				foreach ($tpl['treatment'] as $ct) {
					if (!isset($items[$ct['id']])) {
						continue;
					}
					$k     = $ct['kill'] ?? ($items[$ct['id']]['data']->avdodning ?? null);
					$out[] = ['source' => 'plan', 'plan_id' => $p['id'], 'activity' => $p['name'], 'date' => $start, 'status' => 'plan', 'template' => $tpl['name'], 'template_id' => $tpl['id'], 'apiary_id' => $a['id'], 'treatment_id' => $ct['id'], 'kill' => is_numeric($k) ? (float) $k : null, 'broodless' => $ct['broodless'], 'colony_ids' => $active[$a['id']], 'via' => 'card'];
				}
			}
		}
		return $out;
	}

	/** Samma urval som scopeApiaries i appen: alla, vissa slingor, typer eller utvalda bigårdar. */
	private static function in_scope($a, $s) {
		$routes = (array) ($s['routes'] ?? []);
		$types  = (array) ($s['types'] ?? []);
		$ids    = (array) ($s['apiaries'] ?? []);
		if (($s['all'] ?? true) !== false && !$routes && !$types && !$ids) {
			return true;
		}
		return in_array($a['route_id'], $routes, true) || in_array($a['type_id'], $types, true) || in_array($a['id'], $ids, true);
	}

	public static function visit($org_id, $id, $full = true) {
		global $wpdb;
		$u = $wpdb->users;
		$r = NBS_Repo::is_uuid($id) ? $wpdb->get_row($wpdb->prepare('SELECT v.*, u.display_name AS user FROM ' . self::t('visits') . " v LEFT JOIN $u u ON u.ID = v.user_id WHERE v.org_id = %s AND v.id = %s", $org_id, $id), ARRAY_A) : null;
		if (!$r) {
			return null;
		}
		$v = self::cast_visit($r);
		if ($full) {
			$v['inspections'] = array_map(function ($x) {
				return ['colony_id' => $x['colony_id'], 'skipped' => (bool) $x['skipped'], 'data' => (object) NBS_Repo::unjson($x['data']), 'note' => (string) $x['note']];
			}, $wpdb->get_results($wpdb->prepare('SELECT * FROM ' . self::t('inspections') . ' WHERE org_id = %s AND visit_id = %s', $org_id, $id), ARRAY_A));
			$v['template'] = $v['template_id'] ? self::template($org_id, $v['template_id']) : null;
		}
		return $v;
	}

	/** Planerar besök: ett per bigård i apiary_ids. */
	public static function create($org_id, $d) {
		global $wpdb;
		$tpl = self::template($org_id, $d['template_id'] ?? '');
		if (!$tpl) {
			return new WP_Error('nbs_tpl', 'Välj ett skötselkort.', ['status' => 400]);
		}
		$date = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($d['date'] ?? '')) ? $d['date'] : current_time('Y-m-d');
		$ids  = [];
		foreach ((array) ($d['apiary_ids'] ?? []) as $aid) {
			if (!NBS_Repo::is_uuid($aid) || !NBS_Entities::get($org_id, 'apiary', $aid)) {
				continue;
			}
			$id = wp_generate_uuid4();
			$wpdb->insert(self::t('visits'), [
				'id'          => $id,
				'org_id'      => $org_id,
				'template_id' => $tpl['id'],
				'apiary_id'   => strtolower($aid),
				'visit_date'  => $date,
				'status'      => 'planned',
				'user_id'     => get_current_user_id() ?: null,
				'created_at'  => NBS_DB::now(),
				'updated_at'  => NBS_DB::now(),
			]);
			$ids[] = $id;
		}
		if (!$ids) {
			return new WP_Error('nbs_apiary', 'Välj minst en bigård.', ['status' => 400]);
		}
		NBS_Repo::audit('visit', $ids[0], 'create', ['template' => $tpl['name'], 'count' => count($ids)]);
		return ['ids' => $ids];
	}

	/**
	 * Sparar besöket (utkast): datum, tider, checklista, material, resultat, avvikelse,
	 * uppföljning, anteckningar och kupkontroll per samhälle. Avslutade besök kan bara
	 * få uppföljningen ändrad (t.ex. markeras som åtgärdad).
	 */
	public static function save($org_id, $id, $d) {
		global $wpdb;
		$v = self::visit($org_id, $id);
		if (!$v) {
			return new WP_Error('nbs_404', 'Besöket finns inte.', ['status' => 404]);
		}
		$set = [];
		if (isset($d['followup_done'])) {
			$set['followup_done'] = $d['followup_done'] ? 1 : 0;
		}
		if ($v['status'] === 'done') {
			if ($set) {
				$wpdb->update(self::t('visits'), $set + ['updated_at' => NBS_DB::now()], ['id' => $id, 'org_id' => $org_id]);
			}
			return self::visit($org_id, $id);
		}
		$time = function ($t) {
			return preg_match('/^\d{2}:\d{2}$/', (string) $t) ? $t : null;
		};
		if (isset($d['date']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d['date'])) {
			$set['visit_date'] = $d['date'];
		}
		foreach (['start_time', 'end_time'] as $k) {
			if (array_key_exists($k, $d)) {
				$set[$k] = $time($d[$k]);
			}
		}
		if (isset($d['checked'])) {
			$set['checked'] = NBS_Repo::json(array_values(array_map('intval', (array) $d['checked'])));
		}
		if (array_key_exists('material', $d)) {
			$set['material'] = $d['material'] === null ? null : NBS_Repo::json(self::clean_material($org_id, (array) $d['material']));
		}
		if (array_key_exists('result', $d)) {
			$set['result'] = in_array($d['result'], ['ok', 'action'], true) ? $d['result'] : null;
		}
		foreach (['deviation', 'notes'] as $k) {
			if (array_key_exists($k, $d)) {
				$set[$k] = sanitize_textarea_field((string) $d[$k]);
			}
		}
		if (array_key_exists('followup', $d)) {
			$set['followup'] = $d['followup'] ? 1 : 0;
		}
		if (array_key_exists('followup_date', $d)) {
			$set['followup_date'] = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $d['followup_date']) ? $d['followup_date'] : null;
		}
		if (isset($d['apiary_id']) && NBS_Repo::is_uuid($d['apiary_id']) && NBS_Entities::get($org_id, 'apiary', $d['apiary_id'])) {
			$set['apiary_id'] = strtolower($d['apiary_id']);
		}
		$errors = [];
		if (isset($d['inspections'])) {
			$fields = $v['template'] ? $v['template']['fields'] : [];
			foreach ((array) $d['inspections'] as $ins) {
				$cid = strtolower((string) ($ins['colony_id'] ?? ''));
				if (!NBS_Repo::is_uuid($cid) || !NBS_Entities::get($org_id, 'colony', $cid)) {
					continue;
				}
				$err  = [];
				$vals = NBS_Lists::sanitize_values($fields, (array) ($ins['data'] ?? []), $err);
				foreach ($err as $e) {
					$c        = NBS_Entities::get($org_id, 'colony', $cid);
					$errors[] = 'Samhälle ' . $c['code'] . ': ' . $e;
				}
				$wpdb->query($wpdb->prepare(
					'INSERT INTO ' . self::t('inspections') . ' (id, org_id, visit_id, colony_id, skipped, data, note, updated_at) VALUES (%s, %s, %s, %s, %d, %s, %s, %s) ON DUPLICATE KEY UPDATE skipped = VALUES(skipped), data = VALUES(data), note = VALUES(note), updated_at = VALUES(updated_at)',
					wp_generate_uuid4(), $org_id, $id, $cid, empty($ins['skipped']) ? 0 : 1, NBS_Repo::json((object) $vals), sanitize_textarea_field((string) ($ins['note'] ?? '')), NBS_DB::now()
				));
			}
		}
		if ($v['status'] === 'planned' && (isset($d['inspections']) || isset($d['checked']))) {
			$set['status'] = 'ongoing';
		}
		if ($set) {
			$wpdb->update(self::t('visits'), $set + ['updated_at' => NBS_DB::now()], ['id' => $id, 'org_id' => $org_id]);
		}
		$out = self::visit($org_id, $id);
		if ($errors) {
			$out['warnings'] = $errors;
		}
		return $out;
	}

	private static function clean_material($org_id, $rows) {
		$out = [];
		foreach ($rows as $m) {
			$item = NBS_Repo::is_uuid($m['item_id'] ?? '') ? strtolower($m['item_id']) : null;
			if (!$item) {
				continue;
			}
			$qty   = str_replace(',', '.', (string) ($m['qty'] ?? ''));
			$from  = is_array($m['from'] ?? null) ? ['type' => sanitize_key($m['from']['type'] ?? ''), 'id' => strtolower((string) ($m['from']['id'] ?? ''))] : null;
			$out[] = [
				'item_id' => $item,
				'label'   => sanitize_text_field($m['label'] ?? ''),
				'qty'     => is_numeric($qty) ? (float) $qty : null,
				'per'     => in_array($m['per'] ?? '', self::PER, true) ? $m['per'] : 'colony',
				'kind'    => ($m['kind'] ?? '') === 'move' ? 'move' : 'consume',
				'from'    => $from,
				'skip'    => !empty($m['skip']),
			];
		}
		return $out;
	}

	/** Gör ett läsbart utdrag av kupkontrollen: "Styrka 4/5 · Yngel Ja". */
	public static function summary($fields, $data) {
		$parts = [];
		foreach ($fields as $f) {
			if (!isset($data[$f['key']]) || $data[$f['key']] === '' || $data[$f['key']] === null) {
				continue;
			}
			$v = $data[$f['key']];
			switch ($f['type']) {
				case 'bool':
					$v = $v ? 'Ja' : 'Nej';
					break;
				case 'scale':
					$v = $v . '/' . ($f['max'] ?? 5);
					break;
				case 'number':
					$v = str_replace('.', ',', (string) $v) . (!empty($f['unit']) ? ' ' . $f['unit'] : '');
					break;
				case 'multiselect':
					$v = implode(', ', (array) $v);
					break;
				case 'ref':
					$it = NBS_Repo::is_uuid($v) ? NBS_Lists::get_item(NBS_Auth::org_id(), $v) : null;
					$v  = $it ? $it['name'] : '';
					break;
			}
			if ($v !== '') {
				$parts[] = $f['label'] . ' ' . $v;
			}
		}
		return implode(' · ', $parts);
	}

	/** Avslutar besöket: lagerbokningar, händelser och styrka. Körs i en transaktion. */
	public static function complete($org_id, $id) {
		global $wpdb;
		$v = self::visit($org_id, $id);
		if (!$v) {
			return new WP_Error('nbs_404', 'Besöket finns inte.', ['status' => 404]);
		}
		if ($v['status'] === 'done') {
			return new WP_Error('nbs_done', 'Besöket är redan avslutat.', ['status' => 400]);
		}
		$tpl    = $v['template'];
		$fields = $tpl ? $tpl['fields'] : [];
		$name   = $tpl ? $tpl['name'] : 'Besök';
		$ins    = array_filter($v['inspections'], function ($i) {
			return !$i['skipped'];
		});
		$colony_ids = array_values(array_map(function ($i) {
			return $i['colony_id'];
		}, $ins));

		// 1. Material från lagret.
		$batches = [];
		foreach ((array) $v['material'] as $m) {
			if (!empty($m['skip']) || empty($m['qty']) || $m['qty'] <= 0 || empty($m['from']['id'])) {
				continue;
			}
			$note = $name . ', ' . NBS_Stock::loc_name($org_id, ['apiary', $v['apiary_id']]) . ' ' . $v['date'];
			if ($m['per'] === 'colony') {
				if (!$colony_ids) {
					continue;
				}
				$res = NBS_Stock::distribute($org_id, ['item_id' => $m['item_id'], 'qty' => $m['qty'], 'mode' => 'each', 'kind' => $m['kind'], 'from' => $m['from'], 'colony_ids' => $colony_ids, 'date' => $v['date'], 'note' => $note]);
			} else {
				$res = $m['kind'] === 'move'
					? NBS_Stock::move($org_id, ['item_id' => $m['item_id'], 'qty' => $m['qty'], 'from' => $m['from'], 'to' => ['type' => 'apiary', 'id' => $v['apiary_id']], 'date' => $v['date'], 'note' => $note])
					: NBS_Stock::consume($org_id, ['item_id' => $m['item_id'], 'qty' => $m['qty'], 'from' => $m['from'], 'date' => $v['date'], 'note' => $note]);
			}
			if (is_wp_error($res)) {
				return $res;
			}
			$batches[] = $res['batch_id'];
		}

		// 2. Historik och styrka per samhälle.
		$strength = null;
		foreach ($fields as $f) {
			if (($f['maps'] ?? '') === 'strength') {
				$strength = $f;
			}
		}
		foreach ($ins as $i) {
			$data = (array) $i['data'];
			NBS_Events::add($org_id, 'besok', [
				'colony_id' => $i['colony_id'],
				'other_id'  => $id,
				'data'      => ['template' => $name, 'summary' => self::summary($fields, $data), 'values' => $data],
			], $v['date'], $i['note']);
			if ($strength && isset($data[$strength['key']]) && is_numeric($data[$strength['key']])) {
				// Skalan räknas om till samhällets styrka 1–5.
				$max = (float) ($strength['max'] ?? 5);
				$val = (float) $data[$strength['key']];
				$s   = $max > 0 && $max !== 5.0 ? (int) round($val / $max * 5) : (int) round($val);
				NBS_Entities::patch($org_id, 'colony', $i['colony_id'], ['strength' => max(1, min(5, $s))]);
			}
		}
		$r = self::health_records($org_id, $v, $fields, $ins, $name, $tpl['treatment'] ?? null);
		if (is_wp_error($r)) {
			return $r;
		}
		$created = self::split_off($org_id, $v, $fields, $ins, $name);
		if (is_wp_error($created)) {
			return $created;
		}
		NBS_Events::add($org_id, 'besok', [
			'apiary_id' => $v['apiary_id'],
			'other_id'  => $id,
			'data'      => ['template' => $name, 'colonies' => count($ins), 'result' => $v['result']],
		], $v['date'], $v['deviation']);

		$wpdb->update(self::t('visits'), [
			'status'     => 'done',
			'batches'    => NBS_Repo::json($batches),
			'created'    => $created ? NBS_Repo::json(['colonies' => $created]) : null,
			'end_time'   => $v['end_time'] ?: current_time('H:i'),
			'done_at'    => NBS_DB::now(),
			'updated_at' => NBS_DB::now(),
		], ['id' => $id, 'org_id' => $org_id]);
		NBS_Repo::audit('visit', $id, 'update', ['status' => 'done']);
		return self::visit($org_id, $id);
	}

	/**
	 * Bihälsoposter från besöket (för varroamodellen): fält kopplade till en varroamätning,
	 * behandlingsmedel och förväntad avdödning, samt behandlingsmedel som förbrukats som material.
	 * Posterna får besökets id och tas bort om besöket öppnas igen.
	 */
	private static function health_records($org_id, $v, $fields, $ins, $name, $card_treatment = null) {
		$varroa = [];
		$treat  = null;
		$kill   = null;
		$checks = []; // ja/nej-fält som registrerar en behandling när de kryssas i
		foreach ($fields as $f) {
			$maps = (string) ($f['maps'] ?? '');
			if (strpos($maps, 'treat:') === 0) {
				$checks[$f['key']] = substr($maps, 6);
			} elseif (strpos($maps, 'varroa:') === 0) {
				$varroa[$f['key']] = substr($maps, 7);
			} elseif ($maps === 'treatment') {
				$treat = $f['key'];
			} elseif ($maps === 'kill') {
				$kill = $f['key'];
			}
		}
		// Behandlingsmedlen och vilken lagerartikel de förbrukar.
		$list    = NBS_Lists::get_by_key($org_id, 'behandling');
		$items   = [];
		$by_item = [];
		foreach ($list ? NBS_Lists::items($org_id, $list['id']) : [] as $it) {
			$items[$it['id']] = $it;
			$mat              = (string) ($it['data']->material ?? '');
			if ($mat !== '') {
				$by_item[$mat] = $it['id'];
			}
		}
		$from_material = [];
		foreach ((array) $v['material'] as $m) {
			if (empty($m['skip']) && !empty($m['qty']) && $m['qty'] > 0 && isset($by_item[$m['item_id'] ?? ''])) {
				$from_material[] = $by_item[$m['item_id']];
			}
		}
		$num  = function ($x) {
			$x = str_replace(',', '.', (string) $x);
			return $x !== '' && is_numeric($x) ? (float) $x : null;
		};
		$base = ['rec_date' => $v['date'], 'apiary_id' => $v['apiary_id'], 'visit_id' => $v['id'], 'note' => 'Besök: ' . $name];
		foreach ($ins as $i) {
			$data = (array) $i['data'];
			$rows = [];
			foreach ($varroa as $key => $method) {
				if (($val = $num($data[$key] ?? '')) !== null) {
					$rows[] = ['type' => 'varroa', 'method' => $method, 'value' => $val];
				}
			}
			$given = $kill ? $num($data[$kill] ?? '') : null;
			$done  = [];
			$tid   = $treat ? (string) ($data[$treat] ?? '') : '';
			$cards = [];
			foreach (self::card_treatments($card_treatment) as $ct) {
				if (isset($items[$ct['id']])) {
					$cards[$ct['id']] = $ct;
				}
			}
			$ticks = [];
			foreach ($checks as $key => $t) {
				if (!empty($data[$key]) && isset($items[$t])) {
					$ticks[] = $t;
				}
			}
			foreach (array_merge(isset($items[$tid]) ? [$tid] : [], array_keys($cards), $ticks, $from_material) as $t) {
				if (isset($done[$t])) {
					continue;
				}
				$done[$t] = true;
				// Avdödning: fältet i kupkontrollen, kortets värde, annars behandlingsmedlets.
				$ct     = $cards[$t] ?? null;
				$k      = $given ?? ($ct['kill'] ?? null);
				$rows[] = ['type' => 'behandling', 'treatment_id' => $t, 'value' => $k ?? $num($items[$t]['data']->avdodning ?? ''), 'method' => !empty($ct['broodless']) ? 'yngelfritt' : null];
			}
			foreach ($rows as $row) {
				$res = NBS_Entities::save($org_id, 'health', $row + ['colony_id' => $i['colony_id']] + $base);
				if (is_wp_error($res)) {
					return $res;
				}
			}
		}
		return true;
	}

	/**
	 * Ja/nej-fält kopplade till "split:<behandling>": ikryssat delas en avläggare av från samhället
	 * (t.ex. yngelrumsavläggaren vid Samuel) och den får behandlingen. Returnerar de nya samhällena.
	 */
	private static function split_off($org_id, $v, $fields, $ins, $name) {
		$splits = [];
		foreach ($fields as $f) {
			if (strpos((string) ($f['maps'] ?? ''), 'split:') === 0) {
				$splits[$f['key']] = substr($f['maps'], 6);
			}
		}
		$created = [];
		foreach ($ins as $i) {
			$data = (array) $i['data'];
			foreach ($splits as $key => $t) {
				if (empty($data[$key])) {
					continue;
				}
				$r = NBS_Ops::split($org_id, $i['colony_id'], ['code' => NBS_Ops::next_code($org_id, 'colony'), 'status' => 'avlaggare'], $v['date'], 'Avläggare från besöket ' . $name);
				if (is_wp_error($r)) {
					return $r;
				}
				$child     = $r['child'];
				$created[] = $child['id'];
				$item      = NBS_Lists::get_item($org_id, $t);
				if ($item) {
					$kill = $item['data']->avdodning ?? null;
					$res  = NBS_Entities::save($org_id, 'health', [
						'type'         => 'behandling',
						'treatment_id' => $t,
						'value'        => is_numeric($kill) ? (float) $kill : null,
						'colony_id'    => $child['id'],
						'apiary_id'    => $child['apiary_id'],
						'rec_date'     => $v['date'],
						'visit_id'     => $v['id'],
						'note'         => 'Besök: ' . $name,
					]);
					if (is_wp_error($res)) {
						return $res;
					}
				}
			}
		}
		return $created;
	}

	/** Öppnar ett avslutat besök igen: lagerbokningar och historik ångras. */
	public static function reopen($org_id, $id) {
		global $wpdb;
		$v = self::visit($org_id, $id, false);
		if (!$v || $v['status'] !== 'done') {
			return new WP_Error('nbs_status', 'Besöket är inte avslutat.', ['status' => 400]);
		}
		$raw = $wpdb->get_var($wpdb->prepare('SELECT batches FROM ' . self::t('visits') . ' WHERE id = %s', $id));
		foreach (NBS_Repo::unjson($raw) as $b) {
			$r = NBS_Stock::undo($org_id, $b);
			if (is_wp_error($r) && $r->get_error_code() !== 'nbs_404') {
				return $r;
			}
		}
		$wpdb->delete(NBS_DB::table('events'), ['org_id' => $org_id, 'type' => 'besok', 'other_id' => $id]);
		$wpdb->delete(NBS_Entities::table('health'), ['org_id' => $org_id, 'visit_id' => $id]);
		// Avläggare som besöket delade av tas bort igen (med sina händelser).
		$made = NBS_Repo::unjson($wpdb->get_var($wpdb->prepare('SELECT created FROM ' . self::t('visits') . ' WHERE id = %s', $id)));
		foreach ((array) ($made['colonies'] ?? []) as $cid) {
			$events = NBS_DB::table('events');
			$wpdb->query($wpdb->prepare("DELETE FROM $events WHERE org_id = %s AND (colony_id = %s OR other_id = %s)", $org_id, $cid, $cid)); // phpcs:ignore
			$wpdb->delete(NBS_Entities::table('colony'), ['org_id' => $org_id, 'id' => $cid]);
		}
		$wpdb->update(self::t('visits'), ['status' => 'ongoing', 'batches' => null, 'created' => null, 'done_at' => null, 'updated_at' => NBS_DB::now()], ['id' => $id, 'org_id' => $org_id]);
		NBS_Repo::audit('visit', $id, 'update', ['status' => 'reopened']);
		return self::visit($org_id, $id);
	}

	public static function delete($org_id, $id) {
		global $wpdb;
		$v = self::visit($org_id, $id, false);
		if (!$v) {
			return new WP_Error('nbs_404', 'Besöket finns inte.', ['status' => 404]);
		}
		if ($v['status'] === 'done') {
			$r = self::reopen($org_id, $id);
			if (is_wp_error($r)) {
				return $r;
			}
		}
		$wpdb->delete(self::t('inspections'), ['org_id' => $org_id, 'visit_id' => $id]);
		$wpdb->delete(self::t('visits'), ['org_id' => $org_id, 'id' => $id]);
		NBS_Repo::audit('visit', $id, 'delete', ['date' => $v['date']]);
		return true;
	}

	// ------------------------------------------------------------ Exempelkort

	/** "@Behandlingsmedel" i kortets behandling och fältens kopplingar byts mot postens id. */
	private static function resolve_card_links($d, $find) {
		// Kortets behandlingar: "@Namn" eller [{name, kill, broodless}].
		if (!empty($d['treatment'])) {
			$list = is_string($d['treatment']) ? [['name' => $d['treatment']]] : (array) $d['treatment'];
			$out  = [];
			foreach ($list as $x) {
				$id = $find('behandling', ltrim((string) ($x['name'] ?? ''), '@'));
				if ($id) {
					$out[] = ['id' => $id, 'kill' => $x['kill'] ?? null, 'broodless' => !empty($x['broodless'])];
				}
			}
			$d['treatment'] = $out;
		}
		foreach ($d['fields'] as &$f) {
			if (isset($f['maps']) && preg_match('/^(treat|split):@(.+)$/', $f['maps'], $m)) {
				$id        = $find('behandling', $m[2]);
				$f['maps'] = $id ? $m[1] . ':' . $id : '';
			}
		}
		unset($f);
		return $d;
	}

	/**
	 * Kopplar befintliga standardkort (samma namn som i data/skotselkort.json) till behandlingar och
	 * varroamätningar: fält utan koppling får standardkortets, saknade mätfält läggs till och kortet
	 * får sin behandling om det inte har någon. Egna ändringar i korten lämnas orörda.
	 */
	public static function link_examples($org_id) {
		$file = NBS_DIR . 'data/skotselkort.json';
		$defs = file_exists($file) ? json_decode((string) file_get_contents($file), true) : [];
		$find = function ($key, $name) use ($org_id) {
			$list = NBS_Lists::get_by_key($org_id, $key);
			foreach ($list ? NBS_Lists::items($org_id, $list['id']) : [] as $it) {
				if (mb_strtolower($it['name']) === mb_strtolower($name)) {
					return $it['id'];
				}
			}
			return null;
		};
		$linked = 0;
		foreach (self::templates($org_id) as $t) {
			$def = null;
			foreach ((array) $defs as $d) {
				if ($d['name'] === $t['name']) {
					$def = self::resolve_card_links($d, $find);
				}
			}
			if (!$def) {
				continue;
			}
			$fields  = $t['fields'];
			$changed = false;
			foreach ($def['fields'] as $df) {
				if (empty($df['maps'])) {
					continue;
				}
				$hit = null;
				foreach ($fields as $i => $f) {
					if (mb_strtolower($f['label']) === mb_strtolower($df['label'])) {
						$hit = $i;
					}
				}
				if ($hit === null && preg_match('/^(varroa|split):/', $df['maps'])) {
					$fields[] = $df;
					$changed  = true;
				} elseif ($hit !== null && empty($fields[$hit]['maps']) && $fields[$hit]['type'] === $df['type']) {
					$fields[$hit]['maps'] = $df['maps'];
					$changed              = true;
				}
			}
			$treatment = $t['treatment'];
			if (empty($treatment) && !empty($def['treatment'])) {
				$treatment = $def['treatment'];
				$changed   = true;
			}
			if ($changed) {
				$r = self::save_template($org_id, ['fields' => $fields, 'treatment' => $treatment] + $t, $t['id']);
				$linked += is_wp_error($r) ? 0 : 1;
			}
		}
		return $linked;
	}

	/** Lägger in skötselkorten från driftplan.xlsx (data/skotselkort.json). Befintliga namn hoppas över. */
	public static function import_examples($org_id) {
		$file = NBS_DIR . 'data/skotselkort.json';
		$defs = file_exists($file) ? json_decode((string) file_get_contents($file), true) : [];
		$have = wp_list_pluck(self::templates($org_id), 'name');
		NBS_Starter::ensure_system_lists($org_id);
		$find = function ($key, $name) use ($org_id) {
			$list = NBS_Lists::get_by_key($org_id, $key);
			if (!$list) {
				return null;
			}
			foreach (NBS_Lists::items($org_id, $list['id']) as $it) {
				if (mb_strtolower($it['name']) === mb_strtolower($name)) {
					return $it['id'];
				}
			}
			return null;
		};
		$added = 0;
		foreach ((array) $defs as $i => $d) {
			if (in_array($d['name'], $have, true)) {
				continue;
			}
			$d['category_id'] = !empty($d['category']) ? $find('kategorier', $d['category']) : null;
			$d                = self::resolve_card_links($d, $find);
			foreach ($d['material'] as &$m) {
				$m['item_id'] = !empty($m['item']) ? $find('material', $m['item']) : null;
			}
			unset($m);
			$d['sort'] = ($i + 1) * 10;
			$r         = self::save_template($org_id, $d);
			if (!is_wp_error($r)) {
				$added++;
			}
		}
		return $added;
	}
}
