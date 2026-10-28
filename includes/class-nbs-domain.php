<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * Logik för fas 4–8 som går utöver vanlig registrering: driftplanen (import, avbockning),
 * bihälsa (behandling av flera samhällen med lageruttag), foder per samhälle, honung
 * (partikoder, tappning med burkar från lagret) och ekonomi med nyckeltal.
 */
class NBS_Domain {

	// ------------------------------------------------------------ Inställningar per modul

	const SETTINGS = [
		'feed_target'   => 15,
		'breed_weights' => ['yngel' => 15, 'styrka' => 15, 'temperament' => 20, 'produktion' => 30, 'rensning' => 20],
		'growth_plan'   => [['year' => 1, 'colonies' => 60, 'kg' => 1500], ['year' => 2, 'colonies' => 120, 'kg' => 3000], ['year' => 3, 'colonies' => 150, 'kg' => 4500], ['year' => 5, 'colonies' => 300, 'kg' => 15000]],
		'start_year'    => 2027,
	];

	public static function settings($org_id) {
		$s = NBS_Auth::org_settings($org_id)['modules'] ?? [];
		return array_merge(self::SETTINGS, is_array($s) ? $s : []);
	}

	public static function save_settings($org_id, $d) {
		$cur = self::settings($org_id);
		if (isset($d['feed_target']) && is_numeric($d['feed_target'])) {
			$cur['feed_target'] = max(0, (float) $d['feed_target']);
		}
		if (isset($d['start_year']) && is_numeric($d['start_year'])) {
			$cur['start_year'] = (int) $d['start_year'];
		}
		if (isset($d['breed_weights']) && is_array($d['breed_weights'])) {
			$w = [];
			foreach ($d['breed_weights'] as $k => $v) {
				$k = sanitize_key($k);
				if ($k !== '' && is_numeric($v)) {
					$w[$k] = max(0, (float) $v);
				}
			}
			if ($w) {
				$cur['breed_weights'] = $w;
			}
		}
		if (isset($d['growth_plan']) && is_array($d['growth_plan'])) {
			$cur['growth_plan'] = array_values(array_filter(array_map(function ($r) {
				return isset($r['year']) && is_numeric($r['year']) ? ['year' => (int) $r['year'], 'colonies' => (int) ($r['colonies'] ?? 0), 'kg' => (float) ($r['kg'] ?? 0)] : null;
			}, $d['growth_plan'])));
		}
		$all            = NBS_Auth::org_settings($org_id);
		$all['modules'] = $cur;
		NBS_Auth::save_org_settings($org_id, $all);
		return $cur;
	}

	private static function list_item_id($org_id, $key, $name, $create = false, $color = null) {
		if ($name === '' || $name === null) {
			return null;
		}
		$list = NBS_Lists::get_by_key($org_id, $key);
		if (!$list) {
			return null;
		}
		foreach (NBS_Lists::items($org_id, $list['id']) as $it) {
			if (mb_strtolower($it['name']) === mb_strtolower($name)) {
				return $it['id'];
			}
		}
		if (!$create) {
			return null;
		}
		$it = NBS_Lists::save_item($org_id, $list['id'], ['name' => $name, 'color' => $color]);
		return is_wp_error($it) ? null : $it['id'];
	}

	// ------------------------------------------------------------ Fas 4: driftplan

	/** Lägger in driftplanen från driftplan.xlsx (data/driftplan.json). Befintliga namn hoppas över. */
	public static function plan_import($org_id) {
		NBS_Starter::ensure_system_lists($org_id);
		$defs  = json_decode((string) file_get_contents(NBS_DIR . 'data/driftplan.json'), true) ?: [];
		$have  = [];
		foreach (NBS_Entities::all($org_id, 'plan') as $p) {
			$have[$p['kind'] . '|' . $p['name']] = true;
		}
		$tpls = [];
		foreach (NBS_Visits::templates($org_id) as $t) {
			$tpls[mb_strtolower($t['name'])] = $t['id'];
		}
		$added = 0;
		foreach ($defs as $i => $d) {
			if (isset($have[$d['kind'] . '|' . $d['name']])) {
				continue;
			}
			$res = NBS_Entities::save($org_id, 'plan', [
				'kind'        => $d['kind'],
				'name'        => $d['name'],
				'note'        => $d['note'],
				'category_id' => self::list_item_id($org_id, 'kategorier', $d['category'], true),
				'week_start'  => (int) $d['week_start'],
				'week_end'    => (int) $d['week_end'],
				'owner'       => $d['owner'],
				'status_id'   => self::list_item_id($org_id, 'rutinstatus', $d['status']),
				'template_id' => $d['template'] !== '' ? ($tpls[mb_strtolower($d['template'])] ?? null) : null,
				'scope'       => ['all' => true],
				'sort'        => ($i + 1) * 10,
			]);
			if (!is_wp_error($res)) {
				$added++;
			}
		}
		return $added;
	}

	/** Bockar av (eller av-bockar) en aktivitet för ett år. */
	public static function plan_done($org_id, $id, $year, $done) {
		$p = NBS_Entities::get($org_id, 'plan', $id);
		if (!$p) {
			return new WP_Error('nbs_404', 'Aktiviteten finns inte.', ['status' => 404]);
		}
		$map = is_array($p['done']) ? $p['done'] : [];
		$key = (string) (int) $year;
		if ($done) {
			$u          = wp_get_current_user();
			$map[$key] = ['by' => $u ? $u->display_name : '', 'at' => current_time('Y-m-d')];
		} else {
			unset($map[$key]);
		}
		NBS_Entities::patch($org_id, 'plan', $id, ['done' => NBS_Repo::json((object) $map)]);
		return NBS_Entities::get($org_id, 'plan', $id);
	}

	// ------------------------------------------------------------ Fas 5: bihälsa och foder

	/**
	 * Registrerar samma post på flera samhällen (t.ex. oxalsyra på en hel bigård) och drar
	 * eventuellt behandlingsmedlet ur lagret: stock = { item_id, qty (per samhälle), from }.
	 */
	public static function health_bulk($org_id, $d) {
		$ids = array_values(array_filter((array) ($d['colony_ids'] ?? []), [NBS_Repo::class, 'is_uuid']));
		if (!$ids) {
			return new WP_Error('nbs_colonies', 'Välj minst ett samhälle.', ['status' => 400]);
		}
		$batch = null;
		$stock = $d['stock'] ?? null;
		if (is_array($stock) && !empty($stock['item_id']) && (float) str_replace(',', '.', (string) ($stock['qty'] ?? 0)) > 0) {
			$res = NBS_Stock::distribute($org_id, [
				'item_id'    => $stock['item_id'],
				'qty'        => $stock['qty'],
				'mode'       => 'each',
				'kind'       => 'consume',
				'from'       => $stock['from'] ?? null,
				'colony_ids' => $ids,
				'date'       => $d['rec_date'] ?? null,
				'note'       => 'Behandling',
			]);
			if (is_wp_error($res)) {
				return $res;
			}
			$batch = $res['batch_id'];
		}
		$out = [];
		foreach ($ids as $cid) {
			$c   = NBS_Entities::get($org_id, 'colony', $cid);
			$row = array_intersect_key($d, NBS_Entities::TYPES['health']['cols']);
			$res = NBS_Entities::save($org_id, 'health', ['colony_id' => $cid, 'apiary_id' => $c ? $c['apiary_id'] : null, 'stock_batch' => $batch] + $row);
			if (is_wp_error($res)) {
				return $res;
			}
			$out[] = $res;
		}
		return $out;
	}

	/** Raderar en bihälsopost och ångrar lageruttaget när det var det sista som hörde till det. */
	public static function health_delete($org_id, $id) {
		global $wpdb;
		$h = NBS_Entities::get($org_id, 'health', $id);
		if (!$h) {
			return new WP_Error('nbs_404', 'Posten finns inte.', ['status' => 404]);
		}
		$r = NBS_Entities::delete($org_id, 'health', $id);
		if ($h['stock_batch']) {
			$left = (int) $wpdb->get_var($wpdb->prepare('SELECT COUNT(*) FROM ' . NBS_Entities::table('health') . ' WHERE org_id = %s AND stock_batch = %s', $org_id, $h['stock_batch']));
			if (!$left) {
				$u = NBS_Stock::undo($org_id, $h['stock_batch']);
				if (is_wp_error($u) && $u->get_error_code() !== 'nbs_404') {
					return $u;
				}
			}
		}
		return $r;
	}

	/**
	 * Foder per samhälle ett år, från lagrets förbrukning. Torrsubstansen hämtas från listan
	 * Fodertyper (fodertypens lagerartikel och torrsubstans %).
	 */
	public static function feed($org_id, $year) {
		global $wpdb;
		$ts   = [];
		$list = NBS_Lists::get_by_key($org_id, 'fodertyper');
		if ($list) {
			foreach (NBS_Lists::items($org_id, $list['id']) as $f) {
				$m = $f['data']->material ?? null;
				if ($m) {
					$ts[$m] = isset($f['data']->torrsubstans) ? (float) $f['data']->torrsubstans : null;
				}
			}
		}
		$items = [];
		$mat   = NBS_Lists::get_by_key($org_id, 'material');
		if ($mat) {
			foreach (NBS_Lists::items($org_id, $mat['id']) as $it) {
				if (isset($ts[$it['id']]) || ($it['data']->kategori ?? '') === 'Foder') {
					$items[$it['id']] = ['name' => $it['name'], 'unit' => $it['data']->enhet ?? '', 'ts' => $ts[$it['id']] ?? null];
				}
			}
		}
		$out = ['target' => self::settings($org_id)['feed_target'], 'items' => $items, 'colonies' => (object) []];
		if (!$items) {
			return $out;
		}
		$in   = "'" . implode("','", array_map('esc_sql', array_keys($items))) . "'";
		$rows = $wpdb->get_results($wpdb->prepare(
			'SELECT colony_id, item_id, SUM(qty) AS qty FROM ' . NBS_DB::table('stock_tx') . " WHERE org_id = %s AND type = 'forbrukning' AND colony_id IS NOT NULL AND item_id IN ($in) AND tx_date BETWEEN %s AND %s GROUP BY colony_id, item_id", // phpcs:ignore
			$org_id, $year . '-01-01', $year . '-12-31'
		), ARRAY_A);
		$col = [];
		foreach ($rows as $r) {
			$it = $items[$r['item_id']];
			$c  = $col[$r['colony_id']] ?? ['kg' => 0, 'ts' => 0, 'by' => []];
			$q  = (float) $r['qty'];
			$c['by'][$r['item_id']] = $q;
			if (in_array($it['unit'], ['kg', 'l'], true)) {
				$c['kg'] += $q;
				$c['ts'] += $it['ts'] !== null ? $q * $it['ts'] / 100 : $q;
			}
			$col[$r['colony_id']] = $c;
		}
		$out['colonies'] = (object) $col;
		return $out;
	}

	// ------------------------------------------------------------ Fas 6: honung

	/** Nästa partikod: ÅR-BIGÅRD-LÖPNR, t.ex. 2027-GAD-03. */
	public static function batch_code($org_id, $apiary_id, $year) {
		global $wpdb;
		$a    = NBS_Repo::is_uuid($apiary_id) ? NBS_Entities::get($org_id, 'apiary', $apiary_id) : null;
		$code = $a ? ($a['code'] ?: mb_strtoupper(mb_substr(preg_replace('/[^\p{L}]/u', '', remove_accents($a['name'])), 0, 3))) : 'XXX';
		$base = (int) $year . '-' . $code . '-';
		$like = $wpdb->esc_like($base) . '%';
		$max  = 0;
		foreach ($wpdb->get_col($wpdb->prepare('SELECT code FROM ' . NBS_Entities::table('batch') . ' WHERE org_id = %s AND code LIKE %s', $org_id, $like)) as $c) {
			$max = max($max, (int) substr($c, strlen($base)));
		}
		return $base . str_pad((string) ($max + 1), 2, '0', STR_PAD_LEFT);
	}

	/** Tappning: sparar tappningen och drar burkarna (förpackningen) ur lagret. */
	public static function fill_create($org_id, $d) {
		if (!NBS_Entities::get($org_id, 'batch', $d['batch_id'] ?? '')) {
			return new WP_Error('nbs_batch', 'Välj ett parti.', ['status' => 400]);
		}
		$jars  = (int) ($d['jars'] ?? 0);
		$jar_g = (int) ($d['jar_g'] ?? 0);
		if ($jars <= 0 || $jar_g <= 0) {
			return new WP_Error('nbs_qty', 'Ange antal burkar och burkstorlek.', ['status' => 400]);
		}
		if (empty($d['kg'])) {
			$d['kg'] = round($jars * $jar_g / 1000, 3);
		}
		$batch = null;
		if (!empty($d['product_id']) && !empty($d['from'])) {
			$res = NBS_Stock::consume($org_id, ['item_id' => $d['product_id'], 'qty' => $jars, 'from' => $d['from'], 'kind' => 'forbrukning', 'date' => $d['fill_date'] ?? null, 'note' => 'Tappning']);
			if (is_wp_error($res)) {
				return $res;
			}
			$batch = $res['batch_id'];
		}
		$d['stock_batch'] = $batch;
		$fill = NBS_Entities::save($org_id, 'fill', $d);
		if (!is_wp_error($fill)) {
			$b = NBS_Entities::get($org_id, 'batch', $d['batch_id']);
			if ($b && in_array($b['status'], ['skattad', 'slungad', 'ympad'], true)) {
				NBS_Entities::patch($org_id, 'batch', $b['id'], ['status' => 'tappad']);
			}
		}
		return $fill;
	}

	public static function fill_delete($org_id, $id) {
		$f = NBS_Entities::get($org_id, 'fill', $id);
		if (!$f) {
			return new WP_Error('nbs_404', 'Tappningen finns inte.', ['status' => 404]);
		}
		if ($f['stock_batch']) {
			$u = NBS_Stock::undo($org_id, $f['stock_batch']);
			if (is_wp_error($u) && $u->get_error_code() !== 'nbs_404') {
				return $u;
			}
		}
		return NBS_Entities::delete($org_id, 'fill', $id);
	}

	// ------------------------------------------------------------ Fas 8: ekonomi och nyckeltal

	/** Antal aktiva samhällen ett visst datum, räknat från bildat- och avslutsdatum. */
	private static function colonies_on($org_id, $date) {
		global $wpdb;
		return (int) $wpdb->get_var($wpdb->prepare(
			'SELECT COUNT(*) FROM ' . NBS_Entities::table('colony') . " WHERE org_id = %s AND (started IS NULL OR started <= %s) AND (ended IS NULL OR ended > %s) AND status NOT IN ('sammanslagen')", // phpcs:ignore
			$org_id, $date, $date
		));
	}

	public static function economy($org_id, $year) {
		global $wpdb;
		$year  = (int) $year;
		$from  = $year . '-01-01';
		$to    = $year . '-12-31';
		$tx    = NBS_DB::table('stock_tx');
		$month = function ($rows, $col) {
			$m = array_fill(1, 12, 0.0);
			foreach ($rows as $r) {
				$m[(int) substr($r[$col], 5, 2)] += (float) $r['v'];
			}
			return array_values($m);
		};
		$purchases = $wpdb->get_results($wpdb->prepare("SELECT tx_date, qty * COALESCE(unit_price, 0) AS v FROM $tx WHERE org_id = %s AND type = 'inkop' AND tx_date BETWEEN %s AND %s", $org_id, $from, $to), ARRAY_A); // phpcs:ignore
		$consumed  = (float) $wpdb->get_var($wpdb->prepare("SELECT SUM(qty * COALESCE(unit_price, 0)) FROM $tx WHERE org_id = %s AND type = 'forbrukning' AND tx_date BETWEEN %s AND %s", $org_id, $from, $to)); // phpcs:ignore

		// Nyckeltal.
		$start  = self::colonies_on($org_id, $from);
		$now    = self::colonies_on($org_id, min($to, current_time('Y-m-d')));
		$c      = NBS_Entities::table('colony');
		$dead   = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM $c WHERE org_id = %s AND status = 'dod' AND ended BETWEEN %s AND %s", $org_id, $from, $to)); // phpcs:ignore
		$sold   = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM $c WHERE org_id = %s AND status = 'sald' AND ended BETWEEN %s AND %s", $org_id, $from, $to)); // phpcs:ignore
		$new    = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM $c WHERE org_id = %s AND started BETWEEN %s AND %s", $org_id, $from, $to)); // phpcs:ignore
		$honey  = (float) $wpdb->get_var($wpdb->prepare('SELECT SUM(kg) FROM ' . NBS_Entities::table('batch') . ' WHERE org_id = %s AND year = %d', $org_id, $year));
		$visits = (int) $wpdb->get_var($wpdb->prepare('SELECT COUNT(*) FROM ' . NBS_DB::table('visits') . " WHERE org_id = %s AND status = 'done' AND visit_date BETWEEN %s AND %s", $org_id, $from, $to)); // phpcs:ignore
		$treat  = (int) $wpdb->get_var($wpdb->prepare('SELECT COUNT(*) FROM ' . NBS_Entities::table('health') . " WHERE org_id = %s AND type = 'behandling' AND rec_date BETWEEN %s AND %s", $org_id, $from, $to)); // phpcs:ignore
		$feed   = self::feed($org_id, $year);
		$fed    = (array) $feed['colonies'];
		$ts     = array_sum(array_column($fed, 'ts'));

		return [
			'year'        => $year,
			'budget'      => NBS_Entities::query($org_id, 'budget', ['year' => $year]),
			'ledger'      => NBS_Entities::query($org_id, 'ledger', ['year' => $year]),
			'investments' => NBS_Entities::all($org_id, 'investment'),
			'purchases'   => $month($purchases, 'tx_date'),
			'consumed'    => $consumed,
			'settings'    => self::settings($org_id),
			'kpi'         => [
				'colonies_start' => $start,
				'colonies_now'   => $now,
				'new'            => $new,
				'dead'           => $dead,
				'sold'           => $sold,
				'loss_pct'       => $start ? round($dead / $start * 100, 1) : null,
				'honey_kg'       => $honey,
				'kg_per_colony'  => $start ? round($honey / $start, 1) : null,
				'visits'         => $visits,
				'treatments'     => $treat,
				'fed_colonies'   => count($fed),
				'ts_per_colony'  => $fed ? round($ts / count($fed), 1) : null,
			],
		];
	}
}
