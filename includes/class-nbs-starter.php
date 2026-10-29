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
				['key' => 'behov_per_samhalle', 'label' => 'Behov per samhälle', 'type' => 'number', 'min' => 0, 'help' => 'För behovsberäkningen, t.ex. 7 skattlådor eller 15 kg foder per samhälle.'],
				['key' => 'bibliotek', 'label' => 'Del i kupbiblioteket', 'type' => 'text', 'help' => 'Sätts av kupbyggaren. Artikeln används när en kuptyp läggs ut i kupor.'],
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
				['key' => 'avdodning', 'label' => 'Avdödning', 'type' => 'number', 'unit' => '%', 'min' => 0, 'max' => 100, 'help' => 'Ungefärlig andel av kvalstren som dör, för varroamodellen. Randy Oliver: syntetiska medel ca 95 %, stark myrsyra ca 90 %, svag myrsyra ca 50 %, oxalsyra i yngelfritt samhälle 80–95 %.'],
				['key' => 'foretisk', 'label' => 'Verkar bara på kvalster på bina', 'type' => 'bool', 'help' => 'T.ex. oxalsyra: i ett samhälle med yngel når den bara kvalstren utanför cellerna, och modellen räknar ned avdödningen efter hur mycket yngel det finns.'],
				['key' => 'i_yngel', 'label' => 'Tar bara kvalster i yngel', 'type' => 'bool', 'help' => 'T.ex. drönarramsuttag eller när yngelrummet tas bort (Samuel): modellen räknar med andelen kvalster i yngel.'],
				['key' => 'perioder', 'label' => 'Verkar i antal perioder', 'type' => 'number', 'min' => 1, 'max' => 6, 'help' => 'Långtidsbehandling: avdödningen gäller i så många perioder om ca 15 dagar i rad (t.ex. oxalsyra/glycerin-remsor 85 % i 3 perioder).'],
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
			'honungssorter' => ['Honungssorter', 'Sorter och typer av honung för partier och spårbarhet.', [
				['key' => 'beskrivning', 'label' => 'Beskrivning', 'type' => 'textarea'],
			], [
				['name' => 'Direkttappad honung', 'color' => '#E8B84A'],
				['name' => 'Ympad honung', 'color' => '#F1D58A'],
				['name' => 'Sorthonung', 'color' => '#C8693D'],
				['name' => 'Försommarhonung', 'color' => '#F2D16B'],
				['name' => 'Högsommarhonung', 'color' => '#D99A2B'],
				['name' => 'Sensommarhonung', 'color' => '#9A6A12'],
			]],
			'kunder'        => ['Kunder', 'Kunder och mottagare av honung. Används för återkallelselistor per parti.', [
				['key' => 'typ', 'label' => 'Typ', 'type' => 'select', 'options' => ['Privat', 'Butik', 'Återförsäljare', 'Marknad', 'Restaurang', 'Grossist']],
				['key' => 'kontakt', 'label' => 'Kontaktperson', 'type' => 'text'],
				['key' => 'telefon', 'label' => 'Telefon', 'type' => 'text'],
				['key' => 'epost', 'label' => 'E-post', 'type' => 'text'],
				['key' => 'adress', 'label' => 'Adress', 'type' => 'textarea'],
			]],
			'konton'        => ['Budgetkategorier', 'Kategorier för budget och utfall (som i budgetmallen).', [
				['key' => 'typ', 'label' => 'Typ', 'type' => 'select', 'options' => ['Intäkt', 'Kostnad'], 'required' => true],
				['key' => 'moms', 'label' => 'Moms', 'type' => 'number', 'unit' => '%', 'min' => 0, 'max' => 25],
			], [
				['name' => 'Försäljning varor', 'data' => ['typ' => 'Intäkt', 'moms' => 12]],
				['name' => 'Tjänster', 'data' => ['typ' => 'Intäkt', 'moms' => 25]],
				['name' => 'Konsultintäkter', 'data' => ['typ' => 'Intäkt', 'moms' => 25]],
				['name' => 'Försäljning av samhällen', 'data' => ['typ' => 'Intäkt', 'moms' => 25]],
				['name' => 'Övriga rörelseintäkter', 'data' => ['typ' => 'Intäkt', 'moms' => 25]],
				['name' => 'Förbrukningsvaror', 'data' => ['typ' => 'Kostnad', 'moms' => 25]],
				['name' => 'Varuinköp', 'data' => ['typ' => 'Kostnad', 'moms' => 25]],
				['name' => 'Lokaler', 'data' => ['typ' => 'Kostnad', 'moms' => 25]],
				['name' => 'Fordon', 'data' => ['typ' => 'Kostnad', 'moms' => 25]],
				['name' => 'IT och system', 'data' => ['typ' => 'Kostnad', 'moms' => 25]],
				['name' => 'Marknadsföring', 'data' => ['typ' => 'Kostnad', 'moms' => 25]],
				['name' => 'Marknadsavgifter', 'data' => ['typ' => 'Kostnad', 'moms' => 25]],
				['name' => 'Försäkringar', 'data' => ['typ' => 'Kostnad', 'moms' => 0]],
				['name' => 'Redovisning och bank', 'data' => ['typ' => 'Kostnad', 'moms' => 25]],
				['name' => 'Resor', 'data' => ['typ' => 'Kostnad', 'moms' => 6]],
				['name' => 'Personal', 'data' => ['typ' => 'Kostnad', 'moms' => 0]],
				['name' => 'Övriga externa kostnader', 'data' => ['typ' => 'Kostnad', 'moms' => 25]],
			]],
			'sjukdomar'     => ['Sjukdomar och skadegörare', 'Val vid sjukdomsmisstanke i Bihälsa. Åtgärdsplanen fylls i som förslag och kan ändras per ärende. Grundposterna är förslag – ändra efter bihälsoplanen och bitillsynsmannens råd.', [
				['key' => 'anmalningsplikt', 'label' => 'Anmälningspliktig', 'type' => 'bool'],
				['key' => 'atgard', 'label' => 'Förslag till åtgärdsplan', 'type' => 'textarea'],
			], [
				['name' => 'Amerikansk yngelröta (AFB)', 'data' => ['anmalningsplikt' => true, 'atgard' => 'Anmälningspliktig. Kontakta bitillsynsman/Länsstyrelsen direkt. Flytta inte bin, ramar eller material. Minska flustret mot röveri. Avvakta besked om sanering.']],
				['name' => 'Europeisk yngelröta (EFB)', 'data' => ['atgard' => 'Kontakta bitillsynsman. Isolera samhället, flytta inget material. Sanering (t.ex. skakning till nytt material) enligt råd.']],
				['name' => 'Lilla kupskalbaggen (Aethina tumida)', 'data' => ['anmalningsplikt' => true, 'atgard' => 'Anmälningspliktig. Kontakta Länsstyrelsen/Jordbruksverket omedelbart. Flytta inga bin, ramar eller material. Spara skalbaggar eller larver i sprit som prov.']],
				['name' => 'Tropilaelapskvalster (Tropilaelaps spp.)', 'data' => ['anmalningsplikt' => true, 'atgard' => 'Anmälningspliktig. Kontakta Länsstyrelsen/Jordbruksverket omedelbart. Flytta inga bin, ramar eller material. Spara kvalster eller angripet yngel som prov.']],
				['name' => 'Kalkyngel', 'data' => ['atgard' => 'Ta bort angripna ramar, se till att samhället är starkt och har plats. Byt drottning till en hygienisk linje om det kvarstår.']],
				['name' => 'Säckyngel', 'data' => ['atgard' => 'Ofta övergående. Följ upp vid nästa besök; byt drottning om det kvarstår.']],
				['name' => 'Nosema', 'data' => ['atgard' => 'Byt ut gamla ramar, säkra bra foder och plats. Rengör material från samhället.']],
				['name' => 'Vingmissbildning (DWV)', 'data' => ['atgard' => 'Tecken på högt kvalstertryck. Mät varroa i samhället och bigården och behandla vid behov.']],
			]],
			'lagerplatser'  => ['Lagerplatser', 'Förråd där material lagras, t.ex. centrallagret och honungshuset. Bigårdar och kupor är också lagerplatser, de behöver inte läggas in här.', [
				['key' => 'beskrivning', 'label' => 'Beskrivning', 'type' => 'textarea'],
			]],
		];
	}

	/**
	 * Behandlingsmedel med ungefärlig avdödning efter Randy Olivers tabell i varroamodellen
	 * (scientificbeekeeping.com). Läggs in i nya biodlingar och kompletterar befintliga en gång.
	 */
	const STANDARD_TREATMENTS = [
		['name' => 'Oxalsyra, sublimering', 'data' => ['amne' => 'Oxalsyra', 'metod' => 'Sublimering', 'karens' => 'Inte med skattlådor på', 'material' => '@material:Oxalsyra (sublimering)', 'avdodning' => 90, 'foretisk' => true]],
		['name' => 'Oxalsyra, droppning', 'data' => ['amne' => 'Oxalsyra', 'metod' => 'Dropp', 'karens' => 'Inte med skattlådor på', 'avdodning' => 90, 'foretisk' => true]],
		['name' => 'Oxalsyra/glycerin, remsor (långtid)', 'data' => ['amne' => 'Oxalsyra och glycerin', 'metod' => 'Remsor', 'karens' => 'Inte med skattlådor på', 'avdodning' => 85, 'perioder' => 3]],
		['name' => 'Myrsyra, långtidsbehandling', 'data' => ['amne' => 'Myrsyra', 'metod' => 'Avdunstning, lång', 'karens' => 'Inte med skattlådor på', 'material' => '@material:Myrsyra', 'avdodning' => 90]],
		['name' => 'Myrsyra, snabbehandling (drönarramar)', 'data' => ['amne' => 'Myrsyra', 'metod' => 'Avdunstning, kort', 'material' => '@material:Myrsyra', 'avdodning' => 50]],
		['name' => 'Tymol (t.ex. Apiguard, två omgångar)', 'data' => ['amne' => 'Tymol', 'metod' => 'Avdunstning, lång', 'karens' => 'Inte med skattlådor på', 'avdodning' => 90]],
		['name' => 'Amitraz (t.ex. Apivar)', 'data' => ['amne' => 'Amitraz', 'metod' => 'Remsor', 'karens' => 'Inte med skattlådor på', 'avdodning' => 95]],
		['name' => 'Sockerpudring', 'data' => ['amne' => 'Florsocker', 'metod' => 'Annat', 'avdodning' => 50, 'foretisk' => true]],
		['name' => 'Drönarramsuttag', 'data' => ['amne' => 'Biotekniskt', 'metod' => 'Annat', 'avdodning' => 15, 'dos' => 'En utskuren drönarram (15–20 % per uttag tidigt på säsongen)']],
		['name' => 'Samuel (yngelrummet tas bort)', 'data' => ['amne' => 'Biotekniskt', 'metod' => 'Annat', 'avdodning' => 100, 'i_yngel' => true, 'dos' => 'Kvalstren i yngelrummet följer med ut; kvalstren på bina finns kvar (sublimera samma kväll).']],
		['name' => 'Avläggare eller drottningbyte (yngeluppehåll)', 'data' => ['amne' => 'Biotekniskt', 'metod' => 'Annat', 'avdodning' => 50]],
		['name' => 'Förstasvärm', 'data' => ['amne' => 'Biotekniskt', 'metod' => 'Annat', 'avdodning' => 35]],
	];

	/** Fält som har tillkommit i grundlistorna efter att de skapats: [lista => [fältnycklar]]. */
	const ADDED_FIELDS = [
		'material' => ['behov_per_samhalle', 'bibliotek'],
		'behandling' => ['avdodning', 'foretisk', 'i_yngel', 'perioder'],
	];

	/**
	 * Skapar grundlistor som saknas för organisationen, och lägger till nya fält i
	 * befintliga grundlistor en gång (tas fältet bort av användaren kommer det inte tillbaka).
	 */
	public static function ensure_system_lists($org_id) {
		$sort     = 10;
		$settings = NBS_Auth::org_settings($org_id);
		$done     = $settings['added_fields'] ?? [];
		$changed  = false;
		foreach (self::system_lists() as $key => $def) {
			$list = NBS_Lists::get_by_key($org_id, $key);
			if (!$list) {
				$list = NBS_Lists::create($org_id, ['key' => $key, 'name' => $def[0], 'description' => $def[1], 'fields' => $def[2], 'sort' => $sort], 'system');
				// Grundvärden för listor som skapas första gången (t.ex. honungssorter, budgetkategorier).
				foreach ($def[3] ?? [] as $it) {
					NBS_Lists::save_item($org_id, $list['id'], $it);
				}
			} else {
				$add = [];
				foreach (self::ADDED_FIELDS[$key] ?? [] as $fk) {
					if (empty($done[$key][$fk]) && !in_array($fk, wp_list_pluck($list['fields'], 'key'), true)) {
						foreach ($def[2] as $fd) {
							if ($fd['key'] === $fk) {
								$add[] = $fd;
							}
						}
					}
				}
				if ($add) {
					NBS_Lists::update($org_id, $list['id'], ['fields' => array_merge($list['fields'], $add)]);
				}
			}
			foreach (self::ADDED_FIELDS[$key] ?? [] as $fk) {
				if (empty($done[$key][$fk])) {
					$done[$key][$fk] = 1;
					$changed            = true;
				}
			}
			$sort += 10;
		}
		if ($changed) {
			$settings = NBS_Auth::org_settings($org_id);
			$settings['added_fields'] = $done;
			NBS_Auth::save_org_settings($org_id, $settings);
		}
		self::ensure_treatments($org_id);
	}

	/**
	 * En gång per biodling: standardbehandlingarna som saknas läggs till, och befintliga med samma
	 * namn får avdödning m.m. där fälten är tomma. Därefter kopplas standardkorten.
	 */
	public static function ensure_treatments($org_id) {
		$settings = NBS_Auth::org_settings($org_id);
		if (!empty($settings['std_treatments_1'])) {
			// Nya kopplingar i standardkorten (yngelrumsavläggaren med myrsyra) läggs till en gång.
			if (empty($settings['std_links_2'])) {
				$settings['std_links_2'] = 1;
				NBS_Auth::save_org_settings($org_id, $settings);
				NBS_Visits::link_examples($org_id);
			}
			return;
		}
		$list = NBS_Lists::get_by_key($org_id, 'behandling');
		if (!$list) {
			return;
		}
		$have = [];
		foreach (NBS_Lists::items($org_id, $list['id']) as $it) {
			$have[mb_strtolower($it['name'])] = $it;
		}
		foreach (self::STANDARD_TREATMENTS as $t) {
			$data = array_filter(self::resolve_refs($org_id, $t['data']), function ($v) {
				return $v !== null;
			});
			$it   = $have[mb_strtolower($t['name'])] ?? null;
			if (!$it) {
				NBS_Lists::save_item($org_id, $list['id'], ['name' => $t['name'], 'data' => $data]);
				continue;
			}
			$cur  = (array) $it['data'];
			$fill = array_filter($data, function ($v, $k) use ($cur) {
				return !isset($cur[$k]) || $cur[$k] === '' || $cur[$k] === null;
			}, ARRAY_FILTER_USE_BOTH);
			if ($fill) {
				NBS_Lists::save_item($org_id, $list['id'], ['data' => $cur + $fill], $it['id']);
			}
		}
		$settings                     = NBS_Auth::org_settings($org_id);
		$settings['std_treatments_1'] = 1;
		$settings['std_links_2']      = 1;
		NBS_Auth::save_org_settings($org_id, $settings);
		NBS_Visits::link_examples($org_id);
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
				['name' => 'Inverterad sockerlösning (invintring)', 'data' => ['form' => 'Flytande', 'torrsubstans' => 72, 'material' => '@material:Inverterad sockerlösning']],
				['name' => 'Foderdeg', 'data' => ['form' => 'Deg', 'torrsubstans' => 88, 'material' => '@material:Foderdeg']],
				['name' => 'Socker', 'data' => ['form' => 'Torrt socker', 'torrsubstans' => 100, 'material' => '@material:Socker 15 kg']],
			],
			'behandling'   => self::STANDARD_TREATMENTS,
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
			'lagerplatser' => [
				['name' => 'Centrallager Österbo', 'data' => ['beskrivning' => 'Ladugården, pallstallage och hyllsystem.']],
				['name' => 'Honungshuset', 'data' => ['beskrivning' => 'Burkar, etiketter och färdig honung.']],
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
		$order = ['ramformat', 'kupsystem', 'material', 'linjer', 'fodertyper', 'behandling', 'bigardstyper', 'slingor', 'kategorier', 'rutinstatus', 'markfarger', 'lagerplatser'];
		$all   = self::starter_items();
		foreach ($order as $key) {
			$list = NBS_Lists::get_by_key($org_id, $key);
			if (!$list) {
				continue;
			}
			$items    = NBS_Lists::items($org_id, $list['id']);
			$existing = wp_list_pluck($items, 'name');
			foreach ($all[$key] as $item) {
				if (in_array($item['name'], $existing, true)) {
					// Fyll i tomma värden (t.ex. lagerartikeln på en behandling som lades in före materialet).
					$it   = $items[array_search($item['name'], $existing, true)];
					$cur  = (array) $it['data'];
					$fill = array_filter(self::resolve_refs($org_id, $item['data'] ?? []), function ($v, $k) use ($cur) {
						return $v !== null && (!isset($cur[$k]) || $cur[$k] === '' || $cur[$k] === null);
					}, ARRAY_FILTER_USE_BOTH);
					if ($fill) {
						NBS_Lists::save_item($org_id, $list['id'], ['data' => $cur + $fill], $it['id']);
					}
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
