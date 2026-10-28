<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * Lager (fas 2). Artiklarna är posterna i listan "Material och artiklar", så att
 * användaren själv bestämmer artiklar, enheter, priser och egna fält.
 *
 * Platser: store (en post i listan "Lagerplatser"), apiary (bigård) och hive (kupa).
 * Varje rörelse sparas i stock_tx med från- och tillplats; saldot per plats hålls i
 * stock och ändras i samma databastransaktion. Typer:
 *   inkop       – in till en plats (med pris)
 *   flytt       – från en plats till en annan (t.ex. lådor från lagret till kupa 14)
 *   forbrukning – ut från en plats och bokas på samhället (foder, behandling)
 *   kassering   – ut från en plats utan mottagare
 *   inventering – justering efter räkning (in eller ut)
 * Saldot får aldrig bli negativt.
 */
class NBS_Stock {

	const LOC_TYPES = ['store', 'apiary', 'hive'];
	const TYPES     = ['inkop', 'flytt', 'forbrukning', 'kassering', 'inventering'];
	const EPS       = 0.0005;

	private static function t($n) {
		return NBS_DB::table($n);
	}

	// ------------------------------------------------------------ Artiklar och platser

	private static function list_items($org_id, $key) {
		$list = NBS_Lists::get_by_key($org_id, $key);
		return $list ? NBS_Lists::items($org_id, $list['id']) : [];
	}

	/** Ser till att det finns lagerplatser (samma som i startpaketet, så att inget dubbleras). */
	public static function ensure_store($org_id) {
		NBS_Starter::ensure_system_lists($org_id);
		$list = NBS_Lists::get_by_key($org_id, 'lagerplatser');
		if ($list && !NBS_Lists::items($org_id, $list['id'])) {
			foreach (NBS_Starter::starter_items()['lagerplatser'] as $it) {
				NBS_Lists::save_item($org_id, $list['id'], $it);
			}
		}
	}

	/** Pris för en rörelse: angivet pris, annars artikelns pris, annars senaste inköpspriset. */
	private static function price($org_id, $item, $given) {
		global $wpdb;
		if ($given !== null && $given !== '' && is_numeric(str_replace(',', '.', (string) $given))) {
			return (float) str_replace(',', '.', (string) $given);
		}
		if (isset($item['data']->pris) && is_numeric($item['data']->pris)) {
			return (float) $item['data']->pris;
		}
		$last = $wpdb->get_var($wpdb->prepare('SELECT unit_price FROM ' . self::t('stock_tx') . " WHERE org_id = %s AND item_id = %s AND type = 'inkop' AND unit_price IS NOT NULL ORDER BY tx_date DESC, created_at DESC LIMIT 1", $org_id, $item['id']));
		return $last === null ? null : (float) $last;
	}

	public static function item($org_id, $id) {
		$it = NBS_Repo::is_uuid($id) ? NBS_Lists::get_item($org_id, $id) : null;
		if (!$it) {
			return null;
		}
		$list = NBS_Lists::get_by_key($org_id, 'material');
		return $list && $it['list_id'] === $list['id'] ? $it : null;
	}

	/** Kontrollerar en plats och returnerar [typ, id] eller WP_Error. */
	public static function loc($org_id, $loc) {
		$type = is_array($loc) ? ($loc['type'] ?? '') : '';
		$id   = is_array($loc) ? strtolower((string) ($loc['id'] ?? '')) : '';
		if (!in_array($type, self::LOC_TYPES, true) || !NBS_Repo::is_uuid($id)) {
			return new WP_Error('nbs_loc', 'Välj en plats.', ['status' => 400]);
		}
		if ($type === 'store') {
			$it   = NBS_Lists::get_item($org_id, $id);
			$list = NBS_Lists::get_by_key($org_id, 'lagerplatser');
			$ok   = $it && $list && $it['list_id'] === $list['id'];
		} else {
			$ok = (bool) NBS_Entities::get($org_id, $type, $id);
		}
		return $ok ? [$type, $id] : new WP_Error('nbs_loc', 'Platsen finns inte.', ['status' => 404]);
	}

	/** Aktivt samhälle i en kupa, eller null. */
	public static function colony_in_hive($org_id, $hive_id) {
		global $wpdb;
		$active = "'" . implode("','", NBS_Entities::ACTIVE['colony']) . "'";
		$row    = $wpdb->get_row($wpdb->prepare('SELECT id, apiary_id FROM ' . NBS_Entities::table('colony') . " WHERE org_id = %s AND hive_id = %s AND status IN ($active) LIMIT 1", $org_id, $hive_id), ARRAY_A); // phpcs:ignore
		return $row ?: null;
	}

	public static function balance($org_id, $item_id, $loc, $lock = false) {
		global $wpdb;
		$sql = $wpdb->prepare('SELECT qty FROM ' . self::t('stock') . ' WHERE org_id = %s AND item_id = %s AND loc_type = %s AND loc_id = %s', $org_id, $item_id, $loc[0], $loc[1]);
		return (float) $wpdb->get_var($sql . ($lock ? ' FOR UPDATE' : ''));
	}

	private static function add_balance($org_id, $item_id, $loc, $delta) {
		global $wpdb;
		$wpdb->query($wpdb->prepare(
			'INSERT INTO ' . self::t('stock') . ' (org_id, item_id, loc_type, loc_id, qty, updated_at) VALUES (%s, %s, %s, %s, %f, %s) ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty), updated_at = VALUES(updated_at)',
			$org_id, $item_id, $loc[0], $loc[1], $delta, NBS_DB::now()
		));
	}

	public static function loc_name($org_id, $loc) {
		if (!$loc) {
			return '';
		}
		if ($loc[0] === 'store') {
			$it = NBS_Lists::get_item($org_id, $loc[1]);
			return $it ? $it['name'] : 'lagret';
		}
		$e = NBS_Entities::get($org_id, $loc[0], $loc[1]);
		if (!$e) {
			return '';
		}
		return $loc[0] === 'apiary' ? $e['name'] : 'kupa ' . $e['label'];
	}

	private static function fmt($q) {
		return rtrim(rtrim(number_format((float) $q, 3, ',', ' '), '0'), ',');
	}

	// ------------------------------------------------------------ Bokning

	/**
	 * Bokar en rörelse. $from/$to = [typ, id] eller null. $opts: price, colony_id, note.
	 */
	private static function post($org_id, $batch, $date, $type, $item, $qty, $from, $to, $opts = []) {
		global $wpdb;
		$qty = round((float) $qty, 3);
		if ($qty <= 0) {
			return new WP_Error('nbs_qty', 'Mängden måste vara större än noll.', ['status' => 400]);
		}
		if ($from) {
			$have = self::balance($org_id, $item['id'], $from, true);
			if ($have + self::EPS < $qty) {
				$unit = $item['data']->enhet ?? '';
				return new WP_Error('nbs_short', sprintf('Det finns bara %s %s %s i %s. Registrera ett inköp eller en inventering först.', self::fmt($have), $unit, $item['name'], self::loc_name($org_id, $from)), ['status' => 400]);
			}
			self::add_balance($org_id, $item['id'], $from, -$qty);
		}
		if ($to) {
			self::add_balance($org_id, $item['id'], $to, $qty);
		}
		// Koppla rörelsen till samhälle och bigård för kostnad och historik.
		$colony = $opts['colony_id'] ?? null;
		$apiary = null;
		foreach ([$to, $from] as $loc) {
			if ($loc && $loc[0] === 'hive' && !$colony) {
				$c = self::colony_in_hive($org_id, $loc[1]);
				if ($c) {
					$colony = $c['id'];
					$apiary = $c['apiary_id'];
				}
			}
			if ($loc && $loc[0] === 'apiary' && !$apiary) {
				$apiary = $loc[1];
			}
		}
		if ($colony && !$apiary) {
			$c      = NBS_Entities::get($org_id, 'colony', $colony);
			$apiary = $c ? $c['apiary_id'] : null;
		}
		$price = self::price($org_id, $item, $opts['price'] ?? null);
		$id    = wp_generate_uuid4();
		$wpdb->insert(self::t('stock_tx'), [
			'id'         => $id,
			'org_id'     => $org_id,
			'batch_id'   => $batch,
			'tx_date'    => $date,
			'type'       => $type,
			'item_id'    => $item['id'],
			'qty'        => $qty,
			'unit_price' => $price,
			'from_type'  => $from[0] ?? null,
			'from_id'    => $from[1] ?? null,
			'to_type'    => $to[0] ?? null,
			'to_id'      => $to[1] ?? null,
			'colony_id'  => $colony,
			'apiary_id'  => $apiary,
			'note'       => ($opts['note'] ?? '') !== '' ? $opts['note'] : null,
			'created_at' => NBS_DB::now(),
			'created_by' => get_current_user_id() ?: null,
		]);
		return $id;
	}

	/**
	 * Bokning från andra delar av systemet (t.ex. kuptyper som läggs ut i kupor), med samma
	 * saldokontroll. $from/$to = [typ, id] eller null. Anroparen står för transaktionen.
	 */
	public static function book($org_id, $batch, $date, $type, $item_id, $qty, $from, $to, $opts = []) {
		$item = self::item($org_id, $item_id);
		if (!$item || !in_array($type, self::TYPES, true)) {
			return new WP_Error('nbs_item', 'Artikeln finns inte.', ['status' => 400]);
		}
		return self::post($org_id, $batch, $date, $type, $item, $qty, $from, $to, $opts);
	}

	/** Saldo per artikel på en plats: [item_id => qty]. */
	public static function at($org_id, $loc) {
		global $wpdb;
		$rows = $wpdb->get_results($wpdb->prepare('SELECT item_id, qty FROM ' . self::t('stock') . ' WHERE org_id = %s AND loc_type = %s AND loc_id = %s AND qty > 0', $org_id, $loc[0], $loc[1]), ARRAY_A);
		return array_map('floatval', array_column($rows, 'qty', 'item_id'));
	}

	private static function prep($org_id, $d) {
		$item = self::item($org_id, $d['item_id'] ?? '');
		if (!$item) {
			return new WP_Error('nbs_item', 'Välj en artikel.', ['status' => 400]);
		}
		$date = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($d['date'] ?? '')) ? $d['date'] : current_time('Y-m-d');
		$qty  = str_replace(',', '.', (string) ($d['qty'] ?? ''));
		if (!is_numeric($qty) || (float) $qty <= 0) {
			return new WP_Error('nbs_qty', 'Ange en mängd större än noll.', ['status' => 400]);
		}
		return [$item, $date, (float) $qty, sanitize_textarea_field((string) ($d['note'] ?? ''))];
	}

	private static function done($org_id, $batch, $what) {
		NBS_Repo::audit('stock', $batch, 'create', ['what' => $what]);
		return ['batch_id' => $batch, 'tx' => self::tx_list($org_id, ['batch_id' => $batch])];
	}

	public static function purchase($org_id, $d) {
		$p = self::prep($org_id, $d);
		if (is_wp_error($p)) {
			return $p;
		}
		list($item, $date, $qty, $note) = $p;
		$to = self::loc($org_id, $d['to'] ?? null);
		if (is_wp_error($to)) {
			return $to;
		}
		$batch = NBS_Repo::id($d['id'] ?? null);
		$r     = self::post($org_id, $batch, $date, 'inkop', $item, $qty, null, $to, ['price' => $d['unit_price'] ?? null, 'note' => $note]);
		return is_wp_error($r) ? $r : self::done($org_id, $batch, 'inkop');
	}

	public static function move($org_id, $d) {
		$p = self::prep($org_id, $d);
		if (is_wp_error($p)) {
			return $p;
		}
		list($item, $date, $qty, $note) = $p;
		$from = self::loc($org_id, $d['from'] ?? null);
		$to   = self::loc($org_id, $d['to'] ?? null);
		if (is_wp_error($from) || is_wp_error($to)) {
			return is_wp_error($from) ? $from : $to;
		}
		if ($from === $to) {
			return new WP_Error('nbs_loc', 'Från och till är samma plats.', ['status' => 400]);
		}
		$batch = NBS_Repo::id($d['id'] ?? null);
		$r     = self::post($org_id, $batch, $date, 'flytt', $item, $qty, $from, $to, ['note' => $note]);
		return is_wp_error($r) ? $r : self::done($org_id, $batch, 'flytt');
	}

	/** Förbrukning (bokas på samhället) eller kassering. */
	public static function consume($org_id, $d) {
		$p = self::prep($org_id, $d);
		if (is_wp_error($p)) {
			return $p;
		}
		list($item, $date, $qty, $note) = $p;
		$from = self::loc($org_id, $d['from'] ?? null);
		if (is_wp_error($from)) {
			return $from;
		}
		$type   = ($d['kind'] ?? '') === 'kassering' ? 'kassering' : 'forbrukning';
		$colony = NBS_Repo::is_uuid($d['colony_id'] ?? '') && NBS_Entities::get($org_id, 'colony', $d['colony_id']) ? strtolower($d['colony_id']) : null;
		$batch  = NBS_Repo::id($d['id'] ?? null);
		$r      = self::post($org_id, $batch, $date, $type, $item, $qty, $from, null, ['colony_id' => $colony, 'note' => $note]);
		return is_wp_error($r) ? $r : self::done($org_id, $batch, $type);
	}

	/**
	 * Fördelning på samhällen: mode = total (mängden delas jämnt) eller each (mängd per
	 * samhälle). kind = consume (förbrukning bokad per samhälle) eller move (till varje
	 * samhälles kupa, t.ex. skattlådor).
	 */
	public static function distribute($org_id, $d) {
		$p = self::prep($org_id, $d);
		if (is_wp_error($p)) {
			return $p;
		}
		list($item, $date, $qty, $note) = $p;
		$from = self::loc($org_id, $d['from'] ?? null);
		if (is_wp_error($from)) {
			return $from;
		}
		$colonies = [];
		foreach ((array) ($d['colony_ids'] ?? []) as $cid) {
			$c = NBS_Repo::is_uuid($cid) ? NBS_Entities::get($org_id, 'colony', $cid) : null;
			if ($c && in_array($c['status'], NBS_Entities::ACTIVE['colony'], true)) {
				$colonies[$c['id']] = $c;
			}
		}
		$n = count($colonies);
		if (!$n) {
			return new WP_Error('nbs_colonies', 'Välj minst ett aktivt samhälle.', ['status' => 400]);
		}
		$move = ($d['kind'] ?? '') === 'move';
		if ($move) {
			$missing = array_filter($colonies, function ($c) {
				return !$c['hive_id'];
			});
			if ($missing) {
				return new WP_Error('nbs_hive', 'Samhällena ' . implode(', ', wp_list_pluck($missing, 'code')) . ' har ingen kupa. Koppla en kupa eller välj förbrukning.', ['status' => 400]);
			}
		}
		$total = ($d['mode'] ?? 'total') === 'each' ? $qty * $n : $qty;
		$per   = floor($total / $n * 1000) / 1000;
		$rest  = round($total - $per * $n, 3);
		$batch = NBS_Repo::id($d['id'] ?? null);
		$i     = 0;
		foreach ($colonies as $c) {
			// Det som inte går jämnt ut (avrundning) läggs på det första samhället.
			$q   = $per + ($i++ === 0 ? $rest : 0);
			$r   = $move
				? self::post($org_id, $batch, $date, 'flytt', $item, $q, $from, ['hive', $c['hive_id']], ['colony_id' => $c['id'], 'note' => $note])
				: self::post($org_id, $batch, $date, 'forbrukning', $item, $q, $from, null, ['colony_id' => $c['id'], 'note' => $note]);
			if (is_wp_error($r)) {
				return $r->get_error_code() === 'nbs_short'
					? new WP_Error('nbs_short', sprintf('Det räcker inte: %s %s behövs från %s.', self::fmt($total), $item['data']->enhet ?? '', self::loc_name($org_id, $from)), ['status' => 400])
					: $r;
			}
		}
		return self::done($org_id, $batch, 'fordelning');
	}

	/** Inventering: counts = { artikel-id: räknad mängd } för en plats. */
	public static function count($org_id, $d) {
		$loc = self::loc($org_id, $d['loc'] ?? null);
		if (is_wp_error($loc)) {
			return $loc;
		}
		$date  = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($d['date'] ?? '')) ? $d['date'] : current_time('Y-m-d');
		$note  = sanitize_textarea_field((string) ($d['note'] ?? ''));
		$batch = NBS_Repo::id($d['id'] ?? null);
		$n     = 0;
		foreach ((array) ($d['counts'] ?? []) as $item_id => $counted) {
			$counted = str_replace(',', '.', (string) $counted);
			$item    = self::item($org_id, $item_id);
			if (!$item || $counted === '' || !is_numeric($counted) || (float) $counted < 0) {
				continue;
			}
			$diff = round((float) $counted - self::balance($org_id, $item['id'], $loc, true), 3);
			if (abs($diff) < self::EPS) {
				continue;
			}
			$r = $diff > 0
				? self::post($org_id, $batch, $date, 'inventering', $item, $diff, null, $loc, ['note' => $note])
				: self::post($org_id, $batch, $date, 'inventering', $item, -$diff, $loc, null, ['note' => $note]);
			if (is_wp_error($r)) {
				return $r;
			}
			$n++;
		}
		return $n ? self::done($org_id, $batch, 'inventering') : ['batch_id' => null, 'tx' => []];
	}

	/** Ångrar en hel bokning (alla rader med samma batch_id). */
	public static function undo($org_id, $batch) {
		global $wpdb;
		$rows = $wpdb->get_results($wpdb->prepare('SELECT * FROM ' . self::t('stock_tx') . ' WHERE org_id = %s AND batch_id = %s', $org_id, $batch), ARRAY_A);
		if (!$rows) {
			return new WP_Error('nbs_404', 'Bokningen finns inte.', ['status' => 404]);
		}
		foreach ($rows as $r) {
			if ($r['to_type']) {
				$loc  = [$r['to_type'], $r['to_id']];
				$have = self::balance($org_id, $r['item_id'], $loc, true);
				if ($have + self::EPS < (float) $r['qty']) {
					$item = NBS_Lists::get_item($org_id, $r['item_id']);
					return new WP_Error('nbs_short', sprintf('Kan inte ångra: %s har redan flyttats eller förbrukats från %s.', $item ? $item['name'] : 'artikeln', self::loc_name($org_id, $loc)), ['status' => 400]);
				}
				self::add_balance($org_id, $r['item_id'], $loc, -(float) $r['qty']);
			}
			if ($r['from_type']) {
				self::add_balance($org_id, $r['item_id'], [$r['from_type'], $r['from_id']], (float) $r['qty']);
			}
		}
		$wpdb->delete(self::t('stock_tx'), ['org_id' => $org_id, 'batch_id' => $batch]);
		NBS_Repo::audit('stock', $batch, 'delete', ['rows' => count($rows)]);
		return true;
	}

	// ------------------------------------------------------------ Läsning

	/** Allt som lagervyn behöver: artiklar, lagerplatser och saldon (≠ 0). */
	public static function overview($org_id) {
		global $wpdb;
		self::ensure_store($org_id);
		$rows = $wpdb->get_results($wpdb->prepare('SELECT item_id, loc_type, loc_id, qty FROM ' . self::t('stock') . ' WHERE org_id = %s AND ABS(qty) > 0.0005', $org_id), ARRAY_A);
		$list = NBS_Lists::get_by_key($org_id, 'material');
		// Senaste inköpspris per artikel (används när artikeln saknar pris).
		$t      = self::t('stock_tx');
		$prices = $wpdb->get_results($wpdb->prepare(
			"SELECT x.item_id, x.unit_price FROM $t x JOIN (SELECT item_id, MAX(CONCAT(tx_date, created_at)) AS k FROM $t WHERE org_id = %s AND type = 'inkop' AND unit_price IS NOT NULL GROUP BY item_id) m ON m.item_id = x.item_id AND CONCAT(x.tx_date, x.created_at) = m.k WHERE x.org_id = %s AND x.type = 'inkop'", // phpcs:ignore
			$org_id,
			$org_id
		), ARRAY_A);
		return [
			'last_price' => (object) array_map('floatval', wp_list_pluck($prices, 'unit_price', 'item_id')),
			'items'     => self::list_items($org_id, 'material'),
			'item_list' => $list ? ['id' => $list['id'], 'fields' => $list['fields']] : null,
			'stores'    => self::list_items($org_id, 'lagerplatser'),
			'balances'  => array_map(function ($r) {
				return ['item_id' => $r['item_id'], 'type' => $r['loc_type'], 'id' => $r['loc_id'], 'qty' => (float) $r['qty']];
			}, $rows),
		];
	}

	/** Rörelser med filter: item_id, colony_id, apiary_id, batch_id, loc (typ:id), from/to datum. */
	public static function tx_list($org_id, $f, $limit = 300) {
		global $wpdb;
		$t     = self::t('stock_tx');
		$where = $wpdb->prepare('x.org_id = %s', $org_id);
		foreach (['item_id', 'colony_id', 'apiary_id', 'batch_id'] as $k) {
			if (!empty($f[$k]) && NBS_Repo::is_uuid($f[$k])) {
				$where .= $wpdb->prepare(" AND x.$k = %s", $f[$k]);
			}
		}
		if (!empty($f['loc']) && preg_match('/^(store|apiary|hive):([0-9a-f-]{36})$/', $f['loc'], $m)) {
			$where .= $wpdb->prepare(' AND ((x.from_type = %s AND x.from_id = %s) OR (x.to_type = %s AND x.to_id = %s))', $m[1], $m[2], $m[1], $m[2]);
		}
		if (!empty($f['type']) && in_array($f['type'], self::TYPES, true)) {
			$where .= $wpdb->prepare(' AND x.type = %s', $f['type']);
		}
		foreach (['since' => '>=', 'until' => '<='] as $k => $op) {
			if (!empty($f[$k]) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $f[$k])) {
				$where .= $wpdb->prepare(" AND x.tx_date $op %s", $f[$k]);
			}
		}
		$limit = max(1, min(2000, (int) $limit));
		$u     = $wpdb->users;
		$rows  = $wpdb->get_results("SELECT x.*, u.display_name AS user FROM $t x LEFT JOIN $u u ON u.ID = x.created_by WHERE $where ORDER BY x.tx_date DESC, x.created_at DESC LIMIT $limit", ARRAY_A); // phpcs:ignore
		return array_map(function ($r) {
			return [
				'id'         => $r['id'],
				'batch_id'   => $r['batch_id'],
				'date'       => $r['tx_date'],
				'type'       => $r['type'],
				'item_id'    => $r['item_id'],
				'qty'        => (float) $r['qty'],
				'unit_price' => $r['unit_price'] === null ? null : (float) $r['unit_price'],
				'from'       => $r['from_type'] ? ['type' => $r['from_type'], 'id' => $r['from_id']] : null,
				'to'         => $r['to_type'] ? ['type' => $r['to_type'], 'id' => $r['to_id']] : null,
				'colony_id'  => $r['colony_id'],
				'apiary_id'  => $r['apiary_id'],
				'note'       => (string) $r['note'],
				'user'       => (string) $r['user'],
			];
		}, $rows);
	}

	/** Bygger om saldotabellen från rörelserna (för underhåll/kontroll). */
	public static function rebuild($org_id) {
		global $wpdb;
		$s = self::t('stock');
		$t = self::t('stock_tx');
		$wpdb->delete($s, ['org_id' => $org_id]);
		$now = NBS_DB::now();
		foreach (['to' => '', 'from' => '-'] as $side => $sign) {
			$wpdb->query($wpdb->prepare(
				"INSERT INTO $s (org_id, item_id, loc_type, loc_id, qty, updated_at) SELECT org_id, item_id, {$side}_type, {$side}_id, {$sign}SUM(qty), %s FROM $t WHERE org_id = %s AND {$side}_type IS NOT NULL GROUP BY org_id, item_id, {$side}_type, {$side}_id ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)", // phpcs:ignore
				$now,
				$org_id
			));
		}
		return true;
	}
}
