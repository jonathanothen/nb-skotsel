<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * Kuptyper från kupbyggaren och hur de läggs ut i kupor.
 *
 * En kuptyp är en uppbyggnad av delar ur kupbiblioteket (botten, lådor med ramar, tak …).
 * Den kopplas till en post i listan "Kupsystem och kuptyper", som kuporna pekar på
 * (hive.system_id). Varje biblioteksdel och ramformat motsvarar en artikel i "Material och
 * artiklar" (fältet bibliotek); artikeln skapas första gången den behövs.
 *
 * När en kuptyp läggs ut – som nya kupor i en bigård eller i befintliga kupor – jämförs
 * kupans innehåll i lagret med kuptypens materiallista. Det som saknas flyttas från en
 * lagerplats till kupan och det som blir över går tillbaka, i en bokning som kan ångras.
 * Ramarna i kupor med samhälle står kvar (bina följer med) om inget annat väljs.
 */
class NBS_Hives {

	const KUPDEL = ['Kupdel', 'Ram och vax'];

	// ------------------------------------------------------------ Kuptyper

	public static function save_type($org_id, $d, $id = null) {
		$lib = NBS_Library::get();
		if (is_wp_error($lib)) {
			return $lib;
		}
		$name  = sanitize_text_field((string) ($d['name'] ?? ''));
		$stack = self::clean_stack($lib, $d['stack'] ?? []);
		if ($name === '') {
			return new WP_Error('nbs_invalid', 'Ge kuptypen ett namn.', ['status' => 400]);
		}
		if (is_wp_error($stack)) {
			return $stack;
		}
		$before = $id ? NBS_Entities::get($org_id, 'hivetype', $id) : null;
		if ($id && !$before) {
			return new WP_Error('nbs_404', 'Kuptypen finns inte.', ['status' => 404]);
		}

		// Posten i "Kupsystem och kuptyper" som kuporna pekar på.
		NBS_Starter::ensure_system_lists($org_id);
		$list   = NBS_Lists::get_by_key($org_id, 'kupsystem');
		$boxes  = array_values(array_filter($stack, function ($s) use ($lib) {
			return self::part($lib, $s['part'])['kind'] === 'box';
		}));
		$values = ['ramar' => $boxes ? self::part($lib, $boxes[0]['part'])['frames'] : null];
		$sys    = $before && $before['system_id'] ? NBS_Lists::get_item($org_id, $before['system_id']) : null;
		$sys    = NBS_Lists::save_item($org_id, $list['id'], ['name' => $name, 'data' => array_filter($values) + (array) ($sys['data'] ?? [])], $sys['id'] ?? null);
		if (is_wp_error($sys)) {
			return $sys;
		}
		return NBS_Entities::save($org_id, 'hivetype', [
			'name'      => $name,
			'system_id' => $sys['id'],
			'config'    => ['stack' => $stack],
			'library'   => $lib['version'],
			'note'      => $d['note'] ?? ($before['note'] ?? ''),
		] + ($id ? [] : ['id' => $d['id'] ?? null]), $id);
	}

	private static function part($lib, $id) {
		foreach ($lib['parts'] as $p) {
			if ($p['id'] === $id) {
				return $p;
			}
		}
		return null;
	}

	private static function frame($lib, $id) {
		foreach ($lib['frames'] as $f) {
			if ($f['id'] === $id) {
				return $f;
			}
		}
		return null;
	}

	private static function clean_stack($lib, $stack) {
		$out = [];
		foreach ((array) $stack as $s) {
			$p = is_array($s) ? self::part($lib, (string) ($s['part'] ?? '')) : null;
			if (!$p) {
				return new WP_Error('nbs_invalid', 'Kuptypen innehåller en del som inte finns i kupbiblioteket.', ['status' => 400]);
			}
			$qty    = max(1, min(20, (int) ($s['qty'] ?? 1)));
			$frames = $p['kind'] === 'box' ? max(0, min((int) ($p['frames'] ?? 0), (int) ($s['frames'] ?? 0))) : 0;
			$row    = ['part' => $p['id'], 'qty' => $qty, 'frames' => $frames];
			$color  = strtolower((string) ($s['color'] ?? ''));
			if (preg_match('/^#[0-9a-f]{6}$/', $color)) {
				$row['color'] = $color;
			}
			$out[] = $row;
		}
		return $out ?: new WP_Error('nbs_invalid', 'Kuptypen är tom.', ['status' => 400]);
	}

	// ------------------------------------------------------------ Material

	/** Artiklar i "Material och artiklar" per biblioteksnyckel. */
	private static function material_index($org_id) {
		$list = NBS_Lists::get_by_key($org_id, 'material');
		$out  = [];
		foreach ($list ? NBS_Lists::items($org_id, $list['id']) : [] as $it) {
			$key = (string) ($it['data']->bibliotek ?? '');
			if ($key !== '' && !isset($out[$key])) {
				$out[$key] = $it;
			}
		}
		return [$list, $out];
	}

	/**
	 * Materiallista för en kuptyp: [biblioteksnyckel => [namn, antal, data]]. Ramar får nyckeln
	 * "ram:<ramformat>", delar sitt id i biblioteket.
	 */
	private static function needs($lib, $type) {
		$brands = array_column($lib['brands'], 'name', 'id');
		$system = array_column($lib['systems'], 'name', 'id');
		$out    = [];
		foreach ((array) ($type['config']['stack'] ?? []) as $s) {
			$p = self::part($lib, $s['part']);
			if (!$p) {
				return new WP_Error('nbs_library', 'Kuptypen "' . $type['name'] . '" använder en del som inte längre finns i kupbiblioteket.', ['status' => 400]);
			}
			$out[$p['id']] = $out[$p['id']] ?? [$p['name'] . (isset($system[$p['system']]) ? ' – ' . $system[$p['system']] : ''), 0, [
				'kategori'   => 'Kupdel',
				'enhet'      => 'st',
				'pris'       => $p['price'] ?? null,
				'leverantor' => $brands[$p['brand']] ?? '',
			]];
			$out[$p['id']][1] += (int) $s['qty'];
			if ($p['kind'] === 'box' && (int) $s['frames'] > 0) {
				$f   = self::frame($lib, $p['frame']);
				$key = 'ram:' . $p['frame'];
				$out[$key] = $out[$key] ?? ['Ram ' . ($f['name'] ?? $p['frame']), 0, ['kategori' => 'Ram och vax', 'enhet' => 'st']];
				$out[$key][1] += (int) $s['qty'] * (int) $s['frames'];
			}
		}
		return $out;
	}

	/** Materiallistan som [item_id => antal]; saknade artiklar skapas bara när $create är sant. */
	private static function bom($org_id, $lib, $type, $create, &$names) {
		$needs = self::needs($lib, $type);
		if (is_wp_error($needs)) {
			return $needs;
		}
		list($list, $index) = self::material_index($org_id);
		$out = [];
		foreach ($needs as $key => list($name, $qty, $data)) {
			if (!isset($index[$key])) {
				if (!$create) {
					$out['new:' . $key] = $qty;
					$names['new:' . $key] = $name;
					continue;
				}
				$it = NBS_Lists::save_item($org_id, $list['id'], ['name' => $name, 'data' => array_filter($data + ['bibliotek' => $key], function ($v) {
					return $v !== null && $v !== '';
				})]);
				if (is_wp_error($it)) {
					return $it;
				}
				$index[$key] = $it;
			}
			$out[$index[$key]['id']] = $qty;
			$names[$index[$key]['id']] = $index[$key]['name'];
		}
		return $out;
	}

	/** Artiklar som räknas som kupmaterial (byts vid ersättning) och vilka av dem som är ramar. */
	private static function kupmaterial($org_id) {
		$list  = NBS_Lists::get_by_key($org_id, 'material');
		$all   = [];
		$frame = [];
		foreach ($list ? NBS_Lists::items($org_id, $list['id']) : [] as $it) {
			$lib = (string) ($it['data']->bibliotek ?? '');
			$cat = (string) ($it['data']->kategori ?? '');
			if ($lib !== '' || in_array($cat, self::KUPDEL, true)) {
				$all[$it['id']] = $it['name'];
				if (strpos($lib, 'ram:') === 0 || $cat === 'Ram och vax') {
					$frame[$it['id']] = true;
				}
			}
		}
		return [$all, $frame];
	}

	// ------------------------------------------------------------ Lägga ut kuptyp

	private static function next_label($label) {
		return preg_match('/^(.*?)(\d+)$/', $label, $m) ? $m[1] . str_pad((string) ((int) $m[2] + 1), strlen($m[2]), '0', STR_PAD_LEFT) : $label . '-2';
	}

	/**
	 * Lägger ut en kuptyp. $d: type_id, mode (new|replace), apiary_id + count (new),
	 * hive_ids (replace), store_id, book (lagret följer med), buy (köp in det som saknas),
	 * keep_frames (ramar i kupor med samhälle står kvar), date, dry (bara förhandsvisning).
	 */
	public static function apply($org_id, $d) {
		$type = NBS_Entities::get($org_id, 'hivetype', (string) ($d['type_id'] ?? ''));
		if (!$type) {
			return new WP_Error('nbs_404', 'Välj en kuptyp.', ['status' => 404]);
		}
		$lib = NBS_Library::get();
		if (is_wp_error($lib)) {
			return $lib;
		}
		$dry   = !empty($d['dry']);
		$book  = !empty($d['book']);
		$buy   = !empty($d['buy']);
		$keep  = !array_key_exists('keep_frames', $d) || !empty($d['keep_frames']);
		$date  = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($d['date'] ?? '')) ? $d['date'] : current_time('Y-m-d');
		$mode  = ($d['mode'] ?? '') === 'replace' ? 'replace' : 'new';
		$store = null;
		if ($book) {
			$store = NBS_Stock::loc($org_id, ['type' => 'store', 'id' => $d['store_id'] ?? '']);
			if (is_wp_error($store)) {
				return new WP_Error('nbs_loc', 'Välj lagerplatsen som materialet tas från.', ['status' => 400]);
			}
		}

		// Kuporna som berörs.
		$hives = [];
		if ($mode === 'new') {
			$apiary = NBS_Entities::get($org_id, 'apiary', (string) ($d['apiary_id'] ?? ''));
			$count  = (int) ($d['count'] ?? 0);
			if (!$apiary) {
				return new WP_Error('nbs_invalid', 'Välj bigården som kuporna ska stå i.', ['status' => 400]);
			}
			if ($count < 1 || $count > 200) {
				return new WP_Error('nbs_invalid', 'Antal kupor ska vara 1–200.', ['status' => 400]);
			}
			$label = NBS_Ops::next_code($org_id, 'hive');
			for ($i = 0; $i < $count; $i++) {
				while (!NBS_Entities::unique_ok($org_id, 'hive', $label, null)) {
					$label = self::next_label($label);
				}
				$hives[] = ['id' => null, 'label' => $label, 'colony' => null];
				$label   = self::next_label($label);
			}
		} else {
			foreach (array_unique((array) ($d['hive_ids'] ?? [])) as $hid) {
				$h = NBS_Entities::get($org_id, 'hive', (string) $hid);
				if (!$h) {
					return new WP_Error('nbs_404', 'En av kuporna finns inte.', ['status' => 404]);
				}
				$hives[] = ['id' => $h['id'], 'label' => $h['label'], 'colony' => NBS_Stock::colony_in_hive($org_id, $h['id'])];
			}
			if (!$hives) {
				return new WP_Error('nbs_invalid', 'Välj kupor att ersätta.', ['status' => 400]);
			}
		}

		$names = [];
		$bom   = self::bom($org_id, $lib, $type, !$dry && $book, $names);
		if (is_wp_error($bom)) {
			return $bom;
		}
		list($kup, $frames) = self::kupmaterial($org_id);
		$names += $kup;

		// Skillnad per kupa: in = från lagret till kupan, out = från kupan tillbaka till lagret.
		$plan = [];
		$need = [];
		$back = [];
		foreach ($hives as $h) {
			$current = $h['id'] ? array_intersect_key(NBS_Stock::at($org_id, ['hive', $h['id']]), $kup) : [];
			// I en kupa med samhälle tas inga ramar ut (bina sitter på dem); nya lådor får ändå ramar.
			$keep_out = $keep && $h['colony'] ? $frames : [];
			$in       = [];
			$out      = [];
			foreach ($bom + $current as $item => $_) {
				$diff = ($bom[$item] ?? 0) - ($current[$item] ?? 0);
				if ($diff > NBS_Stock::EPS) {
					$in[$item]   = $diff;
					$need[$item] = ($need[$item] ?? 0) + $diff;
				} elseif ($diff < -NBS_Stock::EPS && !isset($keep_out[$item])) {
					$out[$item]  = -$diff;
					$back[$item] = ($back[$item] ?? 0) - $diff;
				}
			}
			$plan[] = $h + ['in' => $in, 'out' => $out];
		}

		// Det som kommer tillbaka från en kupa kan användas i nästa.
		$items = [];
		foreach ($need + $back as $item => $_) {
			$have    = $store && strpos($item, 'new:') !== 0 ? NBS_Stock::balance($org_id, $item, $store) : 0;
			$short   = max(0, ($need[$item] ?? 0) - $have - ($back[$item] ?? 0));
			$items[] = ['item_id' => $item, 'name' => $names[$item] ?? '', 'need' => $need[$item] ?? 0, 'back' => $back[$item] ?? 0, 'store' => $have, 'short' => $short];
		}
		usort($items, function ($a, $b) {
			return strcmp($a['name'], $b['name']);
		});
		$result = [
			'type'   => ['id' => $type['id'], 'name' => $type['name']],
			'mode'   => $mode,
			'book'   => $book,
			'hives'  => array_map(function ($h) {
				return ['id' => $h['id'], 'label' => $h['label'], 'colony' => $h['colony']['id'] ?? null, 'in' => array_sum($h['in']), 'out' => array_sum($h['out'])];
			}, $plan),
			'items'  => $items,
			'short'  => array_sum(array_column($items, 'short')) > 0,
		];
		if ($dry) {
			return $result;
		}
		if ($book && $result['short'] && !$buy) {
			$miss = array_map(function ($i) {
				return $i['short'] . ' st ' . $i['name'];
			}, array_filter($items, function ($i) {
				return $i['short'] > 0;
			}));
			return new WP_Error('nbs_short', 'Det saknas i lagret: ' . implode(', ', $miss) . '. Registrera inköpet eller välj "Köp in det som saknas".', ['status' => 400]);
		}

		$batch = wp_generate_uuid4();
		$note  = 'Kuptyp ' . $type['name'];
		if ($book && $buy) {
			foreach ($items as $i) {
				if ($i['short'] > 0) {
					$r = NBS_Stock::book($org_id, $batch, $date, 'inkop', $i['item_id'], $i['short'], null, $store, ['note' => $note]);
					if (is_wp_error($r)) {
						return $r;
					}
				}
			}
		}
		foreach ($plan as $k => $h) {
			if ($h['id']) {
				NBS_Entities::patch($org_id, 'hive', $h['id'], ['system_id' => $type['system_id']]);
				continue;
			}
			$new = NBS_Entities::save($org_id, 'hive', ['label' => $h['label'], 'system_id' => $type['system_id'], 'apiary_id' => $d['apiary_id'], 'active' => true]);
			if (is_wp_error($new)) {
				return $new;
			}
			$plan[$k]['id'] = $new['id'];
		}
		if ($book) {
			// Först tillbaka till lagret, sedan ut, så att återlämnat material kan återanvändas.
			foreach (['out', 'in'] as $dir) {
				foreach ($plan as $h) {
					foreach ($h[$dir] as $item => $qty) {
						$hive = ['hive', $h['id']];
						$r    = NBS_Stock::book($org_id, $batch, $date, 'flytt', $item, $qty, $dir === 'out' ? $hive : $store, $dir === 'out' ? $store : $hive, ['note' => $note]);
						if (is_wp_error($r)) {
							return $r;
						}
					}
				}
			}
		}
		NBS_Repo::audit('hivetype', $type['id'], 'update', ['applied' => $mode, 'hives' => count($plan), 'batch' => $book ? $batch : null]);
		return $result + ['batch_id' => $book ? $batch : null, 'hive_ids' => array_column($plan, 'id')];
	}
}
