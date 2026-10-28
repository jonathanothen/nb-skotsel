/**
 * Hämtar BeeBox-sortimentet från Biredskapsdepån (WooCommerce Store API, öppet) och skriver
 * delar, system och kuppaket till library/index.json. Kör igen för att uppdatera priserna:
 *
 *   node tools/biredskapsdepan.mjs
 *
 * Bara fakta sparas: namn, pris, länk och artikelnr. Butikens texter och bilder kopieras inte.
 * Måtten kommer inte från butiken (utom spärrgallrens ungefärliga storlek, som ger lådornas
 * fotavtryck). De är preliminära tills de mätts upp på riktiga lådor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = path.join( path.dirname( fileURLToPath( import.meta.url ) ), '..', 'library', 'index.json' );
const SHOP = 'https://biredskapsdepan.se';
const CATEGORIES = [ 55, 31, 32, 33 ]; // avläggar-/parningskupor, BeeBox LN, BeeBox LS 10, BeeBox LS 9
const TODAY = new Date().toISOString().slice( 0, 10 );
const PRE = 'Preliminära mått (fotavtryck från spärrgallrets storlek, höjder från ramformatet). Ska mätas upp.';
const LOOK = { body: '#fbfbf9', accent: '#e8a417', detail: '#8a8f94' };

// System: fotavtryck [längd längs överlisten, bredd], antal ramar.
const SYSTEMS = {
	'beebox-ls9': { name: 'BeeBox Langstroth 9 ramar', footprint: [ 510, 370 ], frames: 9 },
	'beebox-ls10': { name: 'BeeBox Langstroth 10 ramar', footprint: [ 506, 421 ], frames: 10 },
	'beebox-ln10': { name: 'BeeBox Lågnormal 10 ramar', footprint: [ 430, 430 ], frames: 10 },
	'beebox-ls6': { name: 'BeeBox avläggare/parning 6 ramar', footprint: [ 510, 270 ], frames: 6 },
	'beebox-twin': { name: 'BeeBox Twin parningskupa', footprint: [ 300, 220 ], frames: 0 },
};
const BOX_H = { farrar: 170, langstroth: 243, dadant: 300, lagnormal: 232, hls: 157 };

const box = ( sys, frame, extra = {} ) => ( { kind: 'box', system: sys, frame, frames: SYSTEMS[ sys ].frames, height: BOX_H[ frame ], wall: 25, rabbet: [ 12, 12 ], topSpace: 2, look: { ...LOOK, edges: 8, handles: true }, ...extra } );
const bottom = ( sys, extra = {} ) => ( { kind: 'bottom', system: sys, height: 70, floor: 12, wall: 14, entrance: [ Math.round( SYSTEMS[ sys ].footprint[ 1 ] * 0.6 ), 14 ], look: { ...LOOK, screen: true, reducer: true }, ...extra } );
const sheet = ( sys, kind, extra = {} ) => ( { kind, system: sys, height: 2, look: { ...LOOK, detail: kind === 'excluder' ? '#2b2b2b' : '#d9d4c4', sheet: true }, ...extra } );
const roof = ( sys ) => ( { kind: 'roof', system: sys, height: 45, top: 45, wall: 12, look: { ...LOOK, ribs: 7 } } );
const feeder = ( sys ) => ( { kind: 'feeder', system: sys, height: 80, wall: 20, look: LOOK } );
const acc = ( sys ) => ( { kind: 'accessory', system: sys, height: 0 } );

// Butikens produkt (slug) → del i biblioteket. Befintliga id:n behålls (sparade kuptyper pekar på dem).
const PARTS = {
	// Langstroth 9 ramar
	'beebox-botten-langstroth-9r': [ 'beebox-ls9-botten', 'Botten med nät', bottom( 'beebox-ls9' ) ],
	'beebox-parningsbotten-langstroth-9r': [ 'beebox-ls9-parningsbotten', 'Parningsbotten (4 fluster)', bottom( 'beebox-ls9' ) ],
	'beebox-delbar-sarg-1-1-langstroth-9r': [ 'beebox-ls9-lada-langstroth', 'Sarg Langstroth, delbar', box( 'beebox-ls9', 'langstroth', { divisible: true } ) ],
	'beebox-sarg-3-4-langstroth-9r': [ 'beebox-ls9-lada-farrar', 'Sarg 3/4 Langstroth (Farrar)', box( 'beebox-ls9', 'farrar' ) ],
	'beebox-sparrgaller-langstroth-9r': [ 'beebox-ls9-spargaller', 'Spärrgaller, plast', sheet( 'beebox-ls9', 'excluder' ) ],
	'beebox-svarmlas-langstroth-8-9r': [ 'beebox-ls9-svarmlas', 'Svärmlås', { kind: 'excluder', system: 'beebox-ls9', height: 40, rim: 20, look: LOOK } ],
	'beebox-propolisgaller-langstroth-8-9r': [ 'beebox-ls9-propolisgaller', 'Propolisgaller', sheet( 'beebox-ls9', 'board' ) ],
	'beebox-foderlada-langstroth-9r': [ 'beebox-ls9-foderlada', 'Foderlåda 8,5 l', feeder( 'beebox-ls9' ) ],
	'beebox-tak-langstroth-9r': [ 'beebox-ls9-tak', 'Tak', roof( 'beebox-ls9' ) ],
	'beebox-flusterforminskare-9r': [ 'beebox-ls9-flusterforminskare', 'Flusterförminskare', acc( 'beebox-ls9' ) ],
	'beebox-avdelningsvagg-1-1-langstroth-9r': [ 'beebox-ls9-avdelningsvagg', 'Avdelningsvägg Langstroth', acc( 'beebox-ls9' ) ],
	'beebox-ramspridare-9-till-9': [ 'beebox-ls9-ramspridare-9', 'Ramspridare 9 → 9', acc( 'beebox-ls9' ) ],
	'beebox-ramspridare-9-till-8': [ 'beebox-ls9-ramspridare-8', 'Ramspridare 9 → 8', acc( 'beebox-ls9' ) ],
	// Langstroth 10 ramar
	'beebox-botten-langstroth': [ 'beebox-ls10-botten', 'Botten med nät', bottom( 'beebox-ls10' ) ],
	'beebox-sarg-langstroth': [ 'beebox-ls10-lada-langstroth', 'Sarg Langstroth', box( 'beebox-ls10', 'langstroth' ) ],
	'beebox-sarg-3-4-langstroth': [ 'beebox-ls10-lada-farrar', 'Sarg 3/4 Langstroth (Farrar)', box( 'beebox-ls10', 'farrar' ) ],
	'beebox-sarg-dadant-10r': [ 'beebox-ls10-lada-dadant', 'Sarg Dadant', box( 'beebox-ls10', 'dadant' ) ],
	'beebox-sparrgaller-langstroth-10r': [ 'beebox-ls10-spargaller', 'Spärrgaller, plast', sheet( 'beebox-ls10', 'excluder' ) ],
	'beebox-svarmlas-langstroth': [ 'beebox-ls10-svarmlas', 'Svärmlås', { kind: 'excluder', system: 'beebox-ls10', height: 40, rim: 20, look: LOOK } ],
	'beebox-propolisgaller-langstroth-10r': [ 'beebox-ls10-propolisgaller', 'Propolisgaller', sheet( 'beebox-ls10', 'board' ) ],
	'beebox-foderlada-langstroth': [ 'beebox-ls10-foderlada', 'Foderlåda 10 l', feeder( 'beebox-ls10' ) ],
	'beebox-tak-langstroth': [ 'beebox-ls10-tak', 'Tak', roof( 'beebox-ls10' ) ],
	'beebox-flusterforminskare-10': [ 'beebox-flusterforminskare-10', 'Flusterförminskare', acc( 'beebox-ls10' ), [ 'beebox-ln10' ] ],
	'beebox-ramspridare-10-till-10': [ 'beebox-ramspridare-10', 'Ramspridare 10 → 10', acc( 'beebox-ls10' ), [ 'beebox-ln10' ] ],
	'beebox-ramspridare-10-till-9': [ 'beebox-ramspridare-10-9', 'Ramspridare 10 → 9', acc( 'beebox-ls10' ), [ 'beebox-ln10' ] ],
	'beebox-ramspridare-10-till-8': [ 'beebox-ramspridare-10-8', 'Ramspridare 10 → 8', acc( 'beebox-ls10' ), [ 'beebox-ln10' ] ],
	// Lågnormal / HLS
	'beebox-botten-ln-hls': [ 'beebox-ln10-botten', 'Botten med nät', bottom( 'beebox-ln10' ) ],
	'beebox-sarg-ln': [ 'beebox-ln10-lada-ln', 'Sarg Lågnormal', box( 'beebox-ln10', 'lagnormal' ) ],
	'beebox-sarg-hls': [ 'beebox-ln10-lada-hls', 'Sarg HLS', box( 'beebox-ln10', 'hls' ) ],
	'beebox-sparrgaller-ln-hls': [ 'beebox-ln10-spargaller', 'Spärrgaller, plast', sheet( 'beebox-ln10', 'excluder' ) ],
	'beebox-propolisgaller-lagnormal': [ 'beebox-ln10-propolisgaller', 'Propolisgaller', sheet( 'beebox-ln10', 'board' ) ],
	foderlada: [ 'beebox-ln10-foderlada', 'Foderlåda 10,5 l', feeder( 'beebox-ln10' ) ],
	'tak-ln-hls': [ 'beebox-ln10-tak', 'Tak', roof( 'beebox-ln10' ) ],
	// Avläggare/parning 6 ramar (Langstroth-fotavtryck)
	'beebox-botten-langstroth-6r': [ 'beebox-ls6-botten', 'Botten (fluster fram och bak)', bottom( 'beebox-ls6' ) ],
	'beebox-delbar-sarg-1-1-langstroth-6r': [ 'beebox-ls6-lada-langstroth', 'Sarg Langstroth 6 ramar, delbar', box( 'beebox-ls6', 'langstroth', { divisible: true } ) ],
	'beebox-delbar-sarg-3-4-langstroth-6r': [ 'beebox-ls6-lada-farrar', 'Sarg 3/4 Langstroth 6 ramar, delbar', box( 'beebox-ls6', 'farrar', { divisible: true } ) ],
	'beebox-delbar-sarg-dadant-6r': [ 'beebox-ls6-lada-dadant', 'Sarg Dadant 6 ramar, delbar', box( 'beebox-ls6', 'dadant', { divisible: true } ) ],
	'beebox-foderlada-avlaggar-parningskupa-6r': [ 'beebox-ls6-foderlada', 'Foderlåda 5,5 l', feeder( 'beebox-ls6' ) ],
	'beebox-tak-langstroth-6r': [ 'beebox-ls6-tak', 'Tak', roof( 'beebox-ls6' ) ],
	'beebox-flusterforminskare-6r': [ 'beebox-ls6-flusterforminskare', 'Flusterförminskare', acc( 'beebox-ls6' ) ],
	'beebox-avdelningsvagg-1-1-langstroth-6r': [ 'beebox-ls6-avdelningsvagg-ls', 'Avdelningsvägg Langstroth', acc( 'beebox-ls6' ) ],
	'beebox-avdelningsvagg-3-4-langstroth-6r': [ 'beebox-ls6-avdelningsvagg-farrar', 'Avdelningsvägg 3/4 Langstroth', acc( 'beebox-ls6' ) ],
	'beebox-avdelningsvagg-dadant-6r': [ 'beebox-ls6-avdelningsvagg-dadant', 'Avdelningsvägg Dadant', acc( 'beebox-ls6' ) ],
	// Parningskupa Twin (egna miniramar, mått okända)
	'parningskupa-beebox-twin': [ 'beebox-twin', 'Parningskupa Twin (2 drottningar)', { kind: 'other', system: 'beebox-twin', height: 160, look: LOOK } ],
};

// Kuppaket: grundpaket (botten, yngelrum, spärrgaller, foderlåda, tak, flusterförminskare) + skattlådor.
// [butikens slug, namn, system, yngelrumslåda, antal i yngelrum, skattlåda, med ramar och vax]
const KITS = [
	[ 'kuppaket-beebox-1-1-3-4-langstroth-9r-utan-ramar-vax', 'Langstroth + 3/4 Langstroth', 'beebox-ls9', 'beebox-ls9-lada-langstroth', 2, 'beebox-ls9-lada-farrar', false ],
	[ 'kuppaket-beebox-1-1-langstroth-3-4-langstroth-9r-valbart-antal-skattlador', 'Langstroth + 3/4 Langstroth', 'beebox-ls9', 'beebox-ls9-lada-langstroth', 2, 'beebox-ls9-lada-farrar', true ],
	[ 'kuppaket-beebox-3-4-langstroth-9r-utan-ramar-vax', '3/4 Langstroth', 'beebox-ls9', 'beebox-ls9-lada-farrar', 2, 'beebox-ls9-lada-farrar', false ],
	[ 'kuppaket-beebox-3-4-langstroth-3-4-langstroth-9r-valbart-antal-skattlador', '3/4 Langstroth', 'beebox-ls9', 'beebox-ls9-lada-farrar', 2, 'beebox-ls9-lada-farrar', true ],
	[ 'kuppaket-beebox-1-1-3-4-langstroth-10r-utan-ramar-vax', 'Langstroth + 3/4 Langstroth', 'beebox-ls10', 'beebox-ls10-lada-langstroth', 2, 'beebox-ls10-lada-farrar', false ],
	[ 'kuppaket-beebox-1-1-langstroth-3-4-langstroth-valbart-antal-skattlador', 'Langstroth + 3/4 Langstroth', 'beebox-ls10', 'beebox-ls10-lada-langstroth', 2, 'beebox-ls10-lada-farrar', true ],
	[ 'kuppaket-beebox-3-4-langstroth-10r-utan-ramar-vax', '3/4 Langstroth', 'beebox-ls10', 'beebox-ls10-lada-farrar', 2, 'beebox-ls10-lada-farrar', false ],
	[ 'kuppaket-beebox-3-4-langstroth-3-4-langstroth-valbart-antal-skattlador', '3/4 Langstroth', 'beebox-ls10', 'beebox-ls10-lada-farrar', 2, 'beebox-ls10-lada-farrar', true ],
	[ 'kuppaket-beebox-dadant-3-4-langstroth-10r-utan-ramar-vax', 'Dadant + 3/4 Langstroth', 'beebox-ls10', 'beebox-ls10-lada-dadant', 1, 'beebox-ls10-lada-farrar', false ],
	[ 'kuppaket-beebox-dadant-3-4-langstroth-valbart-antal-skattlador', 'Dadant + 3/4 Langstroth', 'beebox-ls10', 'beebox-ls10-lada-dadant', 1, 'beebox-ls10-lada-farrar', true ],
	[ 'kuppaket-beebox-ln-hls-utan-ramar-vax', 'Lågnormal + HLS', 'beebox-ln10', 'beebox-ln10-lada-ln', 2, 'beebox-ln10-lada-hls', false ],
	[ 'kuppaket-beebox-ln-hls-valbart-antal-skattlador', 'Lågnormal + HLS', 'beebox-ln10', 'beebox-ln10-lada-ln', 2, 'beebox-ln10-lada-hls', true ],
	[ 'kuppaket-beebox-ln-utan-ramar-vax', 'Lågnormal', 'beebox-ln10', 'beebox-ln10-lada-ln', 2, 'beebox-ln10-lada-ln', false ],
	[ 'kuppaket-beebox-ln-ln-valbart-antal-skattlador', 'Lågnormal', 'beebox-ln10', 'beebox-ln10-lada-ln', 2, 'beebox-ln10-lada-ln', true ],
];
// Avläggarkupor: [slug, namn, system, låda, med avdelningsvägg]
const NUCS = [
	[ 'avlaggar-och-parningskupa-langstroth-6r', 'Avläggar-/parningskupa Langstroth 6 ramar', 'beebox-ls6', 'beebox-ls6-lada-langstroth', 'beebox-ls6-avdelningsvagg-ls' ],
	[ 'avlaggar-och-parningskupa-3-4-langstroth-6r', 'Avläggar-/parningskupa 3/4 Langstroth 6 ramar', 'beebox-ls6', 'beebox-ls6-lada-farrar', 'beebox-ls6-avdelningsvagg-farrar' ],
	[ 'avlaggar-och-parningskupa-dadant-6r', 'Avläggar-/parningskupa Dadant 6 ramar', 'beebox-ls6', 'beebox-ls6-lada-dadant', 'beebox-ls6-avdelningsvagg-dadant' ],
	[ 'kuppaket-avlaggare-beebox-ln-1-lada', 'Avläggarkupa Lågnormal 1 låda', 'beebox-ln10', 'beebox-ln10-lada-ln', null ],
];

const get = async ( url ) => {
	const r = await fetch( url, { headers: { 'User-Agent': 'nb-skotsel kupbibliotek (+https://github.com/jonathanothen/nb-skotsel)' } } );
	if ( ! r.ok ) {
		throw new Error( url + ': ' + r.status );
	}
	await new Promise( ( res ) => setTimeout( res, 300 ) );
	return r.json();
};
const price = ( p ) => +p.prices.price / 10 ** p.prices.currency_minor_unit;

const products = {};
for ( const c of CATEGORIES ) {
	for ( const p of await get( `${ SHOP }/wp-json/wc/store/v1/products?category=${ c }&per_page=100` ) ) {
		products[ p.slug ] = p;
	}
}
const lib = JSON.parse( fs.readFileSync( LIB, 'utf8' ) );
const keep = ( arr ) => arr.filter( ( x ) => x.brand !== 'beebox' && ! String( x.system || x.id ).startsWith( 'beebox' ) );
const missing = [];

const retailer = ( p ) => ( { retailer: 'biredskapsdepan', url: p.permalink, price: price( p ), priceDate: TODAY, ...( p.sku ? { sku: p.sku } : {} ) } );
const parts = [];
for ( const [ slug, [ id, name, spec, alsoFor ] ] of Object.entries( PARTS ) ) {
	const p = products[ slug ];
	if ( ! p ) {
		missing.push( slug );
		continue;
	}
	const fp = SYSTEMS[ spec.system ].footprint;
	parts.push( { id, kind: spec.kind, name: 'BeeBox ' + name.charAt( 0 ).toLowerCase() + name.slice( 1 ), brand: 'beebox', source: 'preliminar', outer: fp, ...spec, ...( alsoFor ? { alsoFor } : {} ), ...retailer( p ), note: PRE } );
}

const kits = [];
for ( const [ slug, name, sys, brood, nBrood, sup, withFrames ] of KITS ) {
	const p = products[ slug ];
	if ( ! p ) {
		missing.push( slug );
		continue;
	}
	const prices = {};
	for ( const v of p.variations ) {
		prices[ parseInt( v.attributes[ 0 ].value, 10 ) ] = price( await get( `${ SHOP }/wp-json/wc/store/v1/products/${ v.id }` ) );
	}
	const f = SYSTEMS[ sys ].frames;
	kits.push( {
		id: 'kit-' + slug, name: `Kuppaket BeeBox ${ name } ${ withFrames ? 'med ramar och vax' : 'utan ramar' }`, system: sys, brand: 'beebox',
		stack: [
			{ part: sys + '-botten', qty: 1 },
			{ part: brood, qty: nBrood, frames: f },
			{ part: sys + '-spargaller', qty: 1 },
			{ part: sup, qty: 1, frames: f },
			{ part: sys + '-foderlada', qty: 1 },
			{ part: sys + '-tak', qty: 1 },
			{ part: sys === 'beebox-ls9' ? 'beebox-ls9-flusterforminskare' : 'beebox-flusterforminskare-10', qty: 1 },
		],
		supers: 3, prices, includesFrames: withFrames, ...retailer( p ), price: prices[ 1 ] ?? price( p ),
	} );
}
for ( const [ slug, name, sys, b, wall ] of NUCS ) {
	const p = products[ slug ];
	if ( ! p ) {
		missing.push( slug );
		continue;
	}
	const reducer = sys === 'beebox-ls6' ? 'beebox-ls6-flusterforminskare' : 'beebox-flusterforminskare-10';
	kits.push( {
		id: 'kit-' + slug, name: 'BeeBox ' + name.charAt( 0 ).toLowerCase() + name.slice( 1 ), system: sys, brand: 'beebox',
		stack: [ { part: sys + '-botten', qty: 1 }, { part: b, qty: 1, frames: SYSTEMS[ sys ].frames }, { part: sys + '-tak', qty: 1 }, ...( wall ? [ { part: wall, qty: 1 } ] : [] ), { part: reducer, qty: sys === 'beebox-ls6' ? 2 : 1 } ],
		includesFrames: false, ...retailer( p ),
	} );
}

lib.version = TODAY + '.' + ( ( parseInt( String( lib.version ).split( '.' ).pop(), 10 ) || 0 ) + 1 );
lib.brands = [ ...lib.brands.filter( ( b ) => b.id !== 'beebox' ), { id: 'beebox', name: 'BeeBox (Paradise Honey, Finland)' } ];
lib.retailers = [ { id: 'biredskapsdepan', name: 'Biredskapsdepån', url: SHOP } ];
lib.systems = [ ...keep( lib.systems ), ...Object.entries( SYSTEMS ).map( ( [ id, s ] ) => ( { id, name: s.name, brand: 'beebox', footprint: s.footprint, frameLength: id === 'beebox-ln10' ? 396 : 480, frames: s.frames, spacing: 35, note: PRE } ) ) ];
lib.parts = [ ...keep( lib.parts ), ...parts ];
lib.kits = [ ...keep( lib.kits || [] ), ...kits ];
const order = [ 'schema', 'version', 'about', 'brands', 'retailers', 'systems', 'kits', 'parts', 'frames' ];
fs.writeFileSync( LIB, JSON.stringify( Object.fromEntries( order.map( ( k ) => [ k, lib[ k ] ] ) ), null, 1 ) + '\n' );
console.log( `Version ${ lib.version }: ${ parts.length } BeeBox-delar, ${ kits.length } kuppaket.${ missing.length ? ' Saknas i butiken: ' + missing.join( ', ' ) : '' }` );
