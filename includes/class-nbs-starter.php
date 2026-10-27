<?php
if (!defined('ABSPATH')) {
	exit;
}

/**
 * Grundlistor som alla organisationer får (tomma, med färdiga fält), och ett valfritt
 * startpaket med värden från Nordiska Bins driftplan och projektplan (Fristad).
 */
class NBS_Starter {

	/** Grundlistor: key => [namn, beskrivning, fält]. Ordningen styr sorteringen. */
	public static function system_lists() {
		$units = ['st', 'kg', 'g', 'l', 'ml', 'm', 'förp'];
		return [
			'material'      => ['Material och artiklar', 'Allt som finns i lagret: kupdelar, ramar, foder, behandlingsmedel, burkar och förbrukning.', [
				['key' => 'kategori', 'label' => 'Kategori', 'type' => 'select', 'options' => ['Kupdel', 'Ram och vax', 'Foder', 'Behandling', 'Förpackning', 'Förbrukning', 'Verktyg och utrustning']],
				['key' => 'enhet', 'label' => 'Enhet', 'type' => 'select', 'options' => $units],
				['key' => 'ramformat', 'label' => 'Ramformat', 'type' => 'ref', 'ref' => 'ramformat'],
				['key' => 'kupsystem', 'label' => 'Passar kupsystem', 'type' => 'ref', 'ref' => 'kupsystem'],
				['key' => 'pris', 'label' => 'Pris per enhet', 'type' => 'number', 'unit' => 'kr', 'min' => 0],
				['key' => 'min_saldo', 'label' => 'Minsta saldo', 'type' => 'number', 'min' => 0, 'help' => 'Varning när lagret går under detta.'],
				['key' => 'leverantor', 'label' => 'Leverantör', 'type' => 'text'],
			]],
			'ramformat'     => ['Ramformat', 'Ramformat som används i verksamheten.', [
				['key' => 'matt', 'label' => 'Mått', 'type' => 'text', 'help' => 'T.ex. 448 × 159 mm'],
			]],
			'kupsystem'     => ['Kupsystem och kuptyper', 'Kuptyper och storlekar, t.ex. 9-ramars produktionskupa och 6-ramars avläggarlåda.', [
				['key' => 'ramformat', 'label' => 'Ramformat', 'type' => 'ref', 'ref' => 'ramformat'],
				['key' => 'ramar', 'label' => 'Ramar per låda', 'type' => 'number', 'min' => 1],
				['key' => 'anvandning', 'label' => 'Används till', 'type' => 'multiselect', 'options' => ['Produktion', 'Avläggare', 'Parning', 'Drottningodling']],
			]],
			'linjer'        => ['Bilinjer och raser', 'Raser och avelslinjer för drottningar.', [
				['key' => 'ras', 'label' => 'Ras', 'type' => 'text'],
				['key' => 'ursprung', 'label' => 'Ursprung/uppfödare', 'type' => 'text'],
				['key' => 'stambok', 'label' => 'Stambok/referens', 'type' => 'text'],
			]],
			'fodertyper'    => ['Fodertyper', 'Foder som används vid invintring, drivfodring och stödfodring.', [
				['key' => 'form', 'label' => 'Form', 'type' => 'select', 'options' => ['Flytande', 'Deg', 'Torrt socker']],
				['key' => 'torrsubstans', 'label' => 'Torrsubstans', 'type' => 'number', 'unit' => '%', 'min' => 0, 'max' => 100],
				['key' => 'material', 'label' => 'Lagerartikel', 'type' => 'ref', 'ref' => 'material'],
			]],
			'behandling'    => ['Behandlingsmedel', 'Varroabehandlingar och andra medel.', [
				['key' => 'amne', 'label' => 'Verksamt ämne', 'type' => 'text'],
				['key' => 'metod', 'label' => 'Metod', 'type' => 'select', 'options' => ['Sublimering', 'Dropp', 'Avdunstning, kort', 'Avdunstning, lång', 'Remsor', 'Annat']],
				['key' => 'dos', 'label' => 'Dos per samhälle', 'type' => 'text'],
				['key' => 'karens', 'label' => 'Karens/restriktion', 'type' => 'text', 'help' => 'T.ex. inte med skattlådor på'],
				['key' => 'material', 'label' => 'Lagerartikel', 'type' => 'ref', 'ref' => 'material'],
			]],
			'bigardstyper'  => ['Bigårdstyper', 'Vad en bigård används till.', []],
			'slingor'       => ['Slingor och områden', 'Körslingor eller områden som bigårdarna delas in i.', [
				['key' => 'beskrivning', 'label' => 'Beskrivning', 'type' => 'textarea'],
			]],
			'kategorier'    => ['Aktivitetskategorier', 'Kategorier i driftplanen och för uppgifter.', []],
			'rutinstatus'   => ['Rutinstatus', 'Hur väl en rutin fungerar (driftplanen).', []],
			'markfarger'    => ['Märkfärger för drottningar', 'Internationell färg efter årtalets sista siffra.', [
				['key' => 'slutsiffror', 'label' => 'Årtal som slutar på', 'type' => 'text'],
			]],
		];
	}

	/** Skapar grundlistor som saknas för organisationen. */
	public static function ensure_system_lists($org_id) {
		$sort = 10;
		foreach (self::system_lists() as $key => $def) {
			if (!NBS_Lists::get_by_key($org_id, $key)) {
				NBS_Lists::create($org_id, ['key' => $key, 'name' => $def[0], 'description' => $def[1], 'fields' => $def[2], 'sort' => $sort], 'system');
			}
			$sort += 10;
		}
	}

	/**
	 * Startpaket från Nordiska Bins planer. Värden refererar till andra listor via namn,
	 * som slås upp efter att posterna skapats.
	 */
	public static function starter_items() {
		return [
			'ramformat'    => [
				['name' => 'Farrar', 'data' => []],
			],
			'kupsystem'    => [
				['name' => 'BeeBox 9 ramar Farrar', 'data' => ['ramformat' => '@ramformat:Farrar', 'ramar' => 9, 'anvandning' => ['Produktion', 'Avläggare']]],
				['name' => 'BeeBox 6 ramar Farrar', 'data' => ['ramformat' => '@ramformat:Farrar', 'ramar' => 6, 'anvandning' => ['Avläggare', 'Parning']]],
				['name' => 'Apidea', 'data' => ['anvandning' => ['Parning']]],
			],
			'material'     => [
				['name' => 'Låda 9 ramar Farrar (yngelrum/skattlåda)', 'data' => ['kategori' => 'Kupdel', 'enhet' => 'st', 'ramformat' => '@ramformat:Farrar', 'kupsystem' => '@kupsystem:BeeBox 9 ramar Farrar']],
				['name' => 'Låda 6 ramar Farrar', 'data' => ['kategori' => 'Kupdel', 'enhet' => 'st', 'ramformat' => '@ramformat:Farrar', 'kupsystem' => '@kupsystem:BeeBox 6 ramar Farrar']],
				['name' => 'Botten 9 ramar', 'data' => ['kategori' => 'Kupdel', 'enhet' => 'st', 'kupsystem' => '@kupsystem:BeeBox 9 ramar Farrar']],
				['name' => 'Tak 9 ramar', 'data' => ['kategori' => 'Kupdel', 'enhet' => 'st', 'kupsystem' => '@kupsystem:BeeBox 9 ramar Farrar']],
				['name' => 'Foderlåda', 'data' => ['kategori' => 'Kupdel', 'enhet' => 'st']],
				['name' => 'Ramfodrare', 'data' => ['kategori' => 'Kupdel', 'enhet' => 'st', 'ramformat' => '@ramformat:Farrar']],
				['name' => 'Bitömmarbotten', 'data' => ['kategori' => 'Kupdel', 'enhet' => 'st']],
				['name' => 'Ram Farrar', 'data' => ['kategori' => 'Ram och vax', 'enhet' => 'st', 'ramformat' => '@ramformat:Farrar']],
				['name' => 'Mellanvägg Farrar', 'data' => ['kategori' => 'Ram och vax', 'enhet' => 'st', 'ramformat' => '@ramformat:Farrar']],
				['name' => 'Drönarram (tomram utan tråd)', 'data' => ['kategori' => 'Ram och vax', 'enhet' => 'st', 'ramformat' => '@ramformat:Farrar']],
				['name' => 'Inverterad sockerlösning', 'data' => ['kategori' => 'Foder', 'enhet' => 'kg']],
				['name' => 'Foderdeg', 'data' => ['kategori' => 'Foder', 'enhet' => 'kg']],
				['name' => 'Socker 15 kg', 'data' => ['kategori' => 'Foder', 'enhet' => 'förp']],
				['name' => 'Oxalsyra (sublimering)', 'data' => ['kategori' => 'Behandling', 'enhet' => 'g']],
				['name' => 'Myrsyra', 'data' => ['kategori' => 'Behandling', 'enhet' => 'ml']],
				['name' => 'Spännband', 'data' => ['kategori' => 'Förbrukning', 'enhet' => 'st']],
				['name' => 'Burk 500 g', 'data' => ['kategori' => 'Förpackning', 'enhet' => 'st']],
				['name' => 'Burk 350 g', 'data' => ['kategori' => 'Förpackning', 'enhet' => 'st']],
			],
			'linjer'       => [
				['name' => 'Nordiskt bi', 'data' => ['ras' => 'Apis mellifera mellifera']],
			],
			'fodertyper'   => [
				['name' => 'Inverterad sockerlösning (invintring)', 'data' => ['form' => 'Flytande', 'material' => '@material:Inverterad sockerlösning']],
				['name' => 'Foderdeg', 'data' => ['form' => 'Deg', 'material' => '@material:Foderdeg']],
				['name' => 'Socker', 'data' => ['form' => 'Torrt socker', 'material' => '@material:Socker 15 kg']],
			],
			'behandling'   => [
				['name' => 'Oxalsyra, sublimering', 'data' => ['amne' => 'Oxalsyra', 'metod' => 'Sublimering', 'karens' => 'Inte med skattlådor på', 'material' => '@material:Oxalsyra (sublimering)']],
				['name' => 'Myrsyra, långtidsbehandling', 'data' => ['amne' => 'Myrsyra', 'metod' => 'Avdunstning, lång', 'karens' => 'Inte med skattlådor på', 'material' => '@material:Myrsyra']],
				['name' => 'Myrsyra, snabbehandling (drönarramar)', 'data' => ['amne' => 'Myrsyra', 'metod' => 'Avdunstning, kort', 'material' => '@material:Myrsyra']],
			],
			'bigardstyper' => [
				['name' => 'Produktion', 'color' => '#D99A2B'],
				['name' => 'Avläggare', 'color' => '#4A8A5A'],
				['name' => 'Drottningar och parning', 'color' => '#8E5BA8'],
				['name' => 'Behandling', 'color' => '#C8463D'],
				['name' => 'Test och avel', 'color' => '#3E6F9E'],
			],
			'slingor'      => [
				['name' => 'Slinga 1 Söder'],
				['name' => 'Slinga 2 Nordost'],
				['name' => 'Slinga 3 Nordväst'],
			],
			'kategorier'   => [
				['name' => 'Biskötsel', 'color' => '#4A8A5A'],
				['name' => 'Bihälsa', 'color' => '#C8463D'],
				['name' => 'Drottningodling', 'color' => '#8E5BA8'],
				['name' => 'Honung', 'color' => '#D99A2B'],
				['name' => 'Invintring', 'color' => '#C8693D'],
				['name' => 'Underhåll', 'color' => '#8A8F98'],
				['name' => 'Materialvård', 'color' => '#6E6A64'],
				['name' => 'Administration', 'color' => '#3E6F9E'],
			],
			'rutinstatus'  => [
				['name' => 'Ok', 'color' => '#4A8A5A'],
				['name' => 'Ny rutin', 'color' => '#3E6F9E'],
				['name' => 'Rutin behöver ses över', 'color' => '#D99A2B'],
				['name' => 'Rutin funkar inte', 'color' => '#C8463D'],
			],
			'markfarger'   => [
				['name' => 'Vit', 'color' => '#F5F5F0', 'data' => ['slutsiffror' => '1, 6']],
				['name' => 'Gul', 'color' => '#F2C230', 'data' => ['slutsiffror' => '2, 7']],
				['name' => 'Röd', 'color' => '#D0342C', 'data' => ['slutsiffror' => '3, 8']],
				['name' => 'Grön', 'color' => '#3F9142', 'data' => ['slutsiffror' => '4, 9']],
				['name' => 'Blå', 'color' => '#2F6DB5', 'data' => ['slutsiffror' => '5, 0']],
			],
		];
	}

	/**
	 * Lägger in startpaketet. Poster som redan finns (samma namn i samma lista) hoppas över.
	 * Returnerar antal nya poster.
	 */
	public static function import($org_id) {
		self::ensure_system_lists($org_id);
		$added = 0;
		$order = ['ramformat', 'kupsystem', 'material', 'linjer', 'fodertyper', 'behandling', 'bigardstyper', 'slingor', 'kategorier', 'rutinstatus', 'markfarger'];
		$all   = self::starter_items();
		foreach ($order as $key) {
			$list = NBS_Lists::get_by_key($org_id, $key);
			if (!$list) {
				continue;
			}
			$existing = wp_list_pluck(NBS_Lists::items($org_id, $list['id']), 'name');
			foreach ($all[$key] as $item) {
				if (in_array($item['name'], $existing, true)) {
					continue;
				}
				$data = self::resolve_refs($org_id, $item['data'] ?? []);
				$res  = NBS_Lists::save_item($org_id, $list['id'], ['name' => $item['name'], 'color' => $item['color'] ?? null, 'data' => $data]);
				if (!is_wp_error($res)) {
					$added++;
				}
			}
		}
		return $added;
	}

	/**
	 * Bigårdarna från logistikplanen (13 platser anmälda till Länsstyrelsen 2026-10-02).
	 * Typer och slingor skapas i listorna om de saknas. Bigårdar som redan finns (samma
	 * namn) hoppas över. Position läggs in på kartan i efterhand.
	 */
	public static function import_apiaries($org_id) {
		self::ensure_system_lists($org_id);
		$item_id = function ($key, $name, $color = null) use ($org_id) {
			$list = NBS_Lists::get_by_key($org_id, $key);
			foreach (NBS_Lists::items($org_id, $list['id']) as $it) {
				if ($it['name'] === $name) {
					return $it['id'];
				}
			}
			$it = NBS_Lists::save_item($org_id, $list['id'], ['name' => $name, 'color' => $color]);
			return is_wp_error($it) ? null : $it['id'];
		};
		$prod   = $item_id('bigardstyper', 'Produktion', '#D99A2B');
		$avel   = $item_id('bigardstyper', 'Drottningar och parning', '#8E5BA8');
		$routes = [
			'Slinga 1 Söder'    => ['Gäddviken', 'Prästgården', 'Viby säteri', 'Norrsälja'],
			'Slinga 2 Nordost'  => ['Parningsplatsen', 'Fågelsta syd', 'Fågelsta nord', 'Huggle'],
			'Slinga 3 Nordväst' => ['Svedänge', 'Gräsbovägen', 'Horsskog', 'Västersälja'],
		];
		$rows = [['Österbo vid gården', $prod, null, null, 'Tillfällig uppställning vid gården, t.ex. svärmar innan de flyttas ut. Räknas inte som produktionsbigård.']];
		foreach ($routes as $route => $names) {
			$rid = $item_id('slingor', $route);
			foreach ($names as $name) {
				$rows[] = $name === 'Parningsplatsen'
					? [$name, $avel, $rid, null, 'Avelsplats för parning av drottningar. Drönarövertag från produktionsbigårdarna runt omkring.']
					: [$name, $prod, $rid, 12, ''];
			}
		}
		$existing = wp_list_pluck(NBS_Entities::all($org_id, 'apiary'), 'name');
		$added    = 0;
		$sort     = 10;
		foreach ($rows as $r) {
			if (!in_array($r[0], $existing, true)) {
				$res = NBS_Entities::save($org_id, 'apiary', ['name' => $r[0], 'type_id' => $r[1], 'route_id' => $r[2], 'capacity' => $r[3], 'registered' => '2026-10-02', 'active' => 1, 'sort' => $sort, 'notes' => $r[4]]);
				if (!is_wp_error($res)) {
					$added++;
				}
			}
			$sort += 10;
		}
		return $added;
	}

	/** Byter "@lista:Namn" mot postens id. */
	private static function resolve_refs($org_id, $data) {
		foreach ($data as $k => $v) {
			if (is_string($v) && strpos($v, '@') === 0 && strpos($v, ':') !== false) {
				list($key, $name) = explode(':', substr($v, 1), 2);
				$list = NBS_Lists::get_by_key($org_id, $key);
				$data[$k] = null;
				if ($list) {
					foreach (NBS_Lists::items($org_id, $list['id']) as $it) {
						if ($it['name'] === $name) {
							$data[$k] = $it['id'];
							break;
						}
					}
				}
			}
		}
		return $data;
	}
}
