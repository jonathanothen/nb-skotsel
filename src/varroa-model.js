/**
 * Randy Olivers varroamodell (Randy's Varroa Model, © Randy Oliver 2016, scientificbeekeeping.com),
 * överförd från kalkylbladet "Randys-Varroa-Model-Österbo.xlsx", bladet Modersamhället.
 *
 * Året delas i 25 perioder (1:a och 15:e varje månad, plus 31 dec), ca 15,2 dagar var. För varje
 * period räknas kvalstrens förökning i arbetar- och drönaryngel (Poisson-fördelad invasion av celler),
 * naturlig dödlighet, invandring och avdrift med flygbin, åldrande kvalster (> 75 dagar förökar sig
 * inte) och behandlingarnas avdödning. Kolumnnamnen i kommentarerna (BB, DF …) är kalkylbladets.
 */

/** Samhällstyper: per period [ramar med yngel, ramar täckta med bin, andel drönaryngel]. */
export const COLONY_TYPES = {
	d: { name: 'Normalt samhälle, tempererat klimat, svärmförebyggt (lite höstyngel)', rows: [ [ 0, 8, 0 ], [ 0.25, 8, 0 ], [ 0.33, 8, 0 ], [ 0.75, 7, 0 ], [ 1, 7, 0 ], [ 2, 6, 0 ], [ 3, 6, 0.03 ], [ 5, 8, 0.06 ], [ 6, 11, 0.06 ], [ 6.5, 15, 0.06 ], [ 7, 19, 0.05 ], [ 6.5, 22, 0.05 ], [ 6, 24, 0.05 ], [ 5, 25, 0.05 ], [ 4.5, 25, 0.05 ], [ 4, 22, 0.05 ], [ 3.5, 19, 0.02 ], [ 4, 16, 0.02 ], [ 2, 15, 0 ], [ 0.5, 12, 0 ], [ 0.25, 9, 0 ], [ 0.125, 8.5, 0 ], [ 0.1, 8.25, 0 ], [ 0, 8, 0 ], [ 0.125, 8, 0 ] ] },
	b: { name: 'Nordligt läge: kort sommar, långt yngeluppehåll på vintern', rows: [ [ 0.043, 8, 0 ], [ 0, 8, 0 ], [ 0, 8, 0 ], [ 0.043, 8, 0 ], [ 0, 7, 0 ], [ 0.5, 6, 0.02 ], [ 1, 6, 0.03 ], [ 5, 6, 0.06 ], [ 7, 10, 0.1 ], [ 7, 14, 0.1 ], [ 8, 20, 0.05 ], [ 8, 24, 0.05 ], [ 6, 26, 0.05 ], [ 5, 26, 0.05 ], [ 4.5, 25, 0.05 ], [ 4, 20, 0.05 ], [ 3.5, 14, 0.02 ], [ 3, 12, 0.02 ], [ 0.5, 10, 0 ], [ 0.1, 9, 0 ], [ 0, 8, 0 ], [ 0, 8, 0 ], [ 0, 8, 0 ], [ 0, 8, 0 ], [ 0, 8, 0 ] ] },
	n: { name: 'Avläggare: 5 ramar bin, 3 ramar yngel, startad 1 april', rows: [ [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 0, 0 ], [ 2.5, 5, 0 ], [ 5, 7, 0.01 ], [ 6, 10, 0.02 ], [ 7, 13, 0.03 ], [ 8, 16, 0.04 ], [ 8, 19, 0.05 ], [ 6, 23, 0.05 ], [ 5, 24, 0.02 ], [ 4.5, 23, 0.01 ], [ 4, 20, 0.01 ], [ 3.5, 14, 0.01 ], [ 4, 12, 0.01 ], [ 3, 10, 0 ], [ 2, 9, 0 ], [ 1, 8, 0 ], [ 0, 7, 0 ], [ 0, 6, 0 ], [ 0, 6, 0 ], [ 0, 6, 0 ] ] },
	p: { name: 'Paketbin (ca 1,4 kg) på utbyggda ramar, välfodrat', rows: [ [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 6, 0 ], [ 3, 5, 0 ], [ 4, 9, 0 ], [ 7, 13, 0.05 ], [ 8, 17, 0.05 ], [ 8, 21, 0.05 ], [ 8, 25, 0.05 ], [ 5, 26, 0.05 ], [ 4.5, 25, 0.05 ], [ 4, 20, 0.05 ], [ 3.5, 14, 0.02 ], [ 4, 12, 0.02 ], [ 3, 10, 0 ], [ 2, 9, 0 ], [ 1, 8, 0 ], [ 0, 7, 0 ], [ 0, 6, 0 ], [ 0, 6, 0 ], [ 0, 6, 0 ] ] },
	s: { name: 'Samhälle som svärmar i maj (ange 50–60 % avdödning 15 maj)', rows: [ [ 0, 8, 0 ], [ 0.25, 8, 0 ], [ 0.5, 8, 0 ], [ 0.5, 7, 0 ], [ 1, 7, 0 ], [ 2, 6, 0.02 ], [ 3, 6, 0.03 ], [ 5, 8, 0.06 ], [ 7, 10, 0.1 ], [ 2, 14, 0.1 ], [ 6, 8, 0.05 ], [ 6, 12, 0.05 ], [ 5.5, 16, 0.05 ], [ 5, 21, 0.05 ], [ 4.5, 22, 0.05 ], [ 4, 22, 0.05 ], [ 3.5, 19, 0.02 ], [ 4, 16, 0.02 ], [ 2, 15, 0 ], [ 0.5, 12, 0 ], [ 0, 8, 0 ], [ 0, 7, 0 ], [ 0, 7, 0 ], [ 0, 7, 0 ], [ 0, 7, 0 ] ] },
	f: { name: 'Vildsamhälle i 40 liters hålighet, svärmar två gånger', rows: [ [ 0, 5, 0 ], [ 0, 5, 0 ], [ 0, 4.5, 0 ], [ 0.5, 4.5, 0 ], [ 0.5, 4, 0 ], [ 0.75, 4, 0 ], [ 0.75, 4, 0 ], [ 1, 4, 0 ], [ 1.5, 4, 0 ], [ 1.5, 3.5, 0.05 ], [ 1.75, 4.5, 0.05 ], [ 2, 5, 0.05 ], [ 2, 5.1, 0.05 ], [ 1.75, 5.2, 0.05 ], [ 2, 5.5, 0.05 ], [ 2.2, 6, 0.05 ], [ 2, 6.2, 0.02 ], [ 2, 6.5, 0.02 ], [ 1.5, 6.5, 0 ], [ 1.5, 6, 0 ], [ 1, 5.5, 0 ], [ 0, 5, 0 ], [ 0, 5, 0 ], [ 0, 5, 0 ], [ 0, 5, 0 ] ] },
	a: { name: 'Subtropiskt, torrt klimat utan vinteruppehåll', rows: [ [ 2, 7, 0 ], [ 3, 7, 0 ], [ 4, 10, 0 ], [ 5, 12, 0 ], [ 7, 12, 0 ], [ 7.5, 14, 0.02 ], [ 8, 16, 0.03 ], [ 7, 18, 0.06 ], [ 6, 18, 0.06 ], [ 6, 16, 0.06 ], [ 5, 15, 0.05 ], [ 4, 14, 0.05 ], [ 4, 13, 0.05 ], [ 3, 12, 0.05 ], [ 2, 10, 0.05 ], [ 2, 8, 0.05 ], [ 2, 7, 0.02 ], [ 4, 7.5, 0.02 ], [ 4, 8, 0 ], [ 3, 10, 0 ], [ 2, 10, 0 ], [ 2, 9, 0 ], [ 2, 8, 0 ], [ 2, 7, 0 ], [ 2, 7, 0 ] ] },
};

/** Invandring av kvalster per period (antal), efter nivå 1–4. Nivå 0 = inga grannar. */
export const IMMIGRATION = {
	1: [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 5, 8, 15, 20, 25, 15, 6, 0, 0, 0, 0, 0 ],
	2: [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 5, 10, 15, 30, 40, 50, 30, 15, 0, 0, 0, 0, 0 ],
	3: [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 15, 20, 50, 100, 125, 100, 50, 30, 0, 0, 0, 0, 0 ],
	4: [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 20, 30, 45, 130, 175, 210, 180, 130, 70, 0, 0, 0, 0, 0 ],
};
export const IMMIGRATION_LEVELS = [
	[ 0, 'Inga grannar' ],
	[ 1, 'Bigårdar med varroakontroll' ],
	[ 2, 'Bigårdar med varroaproblem' ],
	[ 3, 'Kollapsande vildsamhällen, mycket röveri' ],
	[ 4, 'Obehandlade samhällen i närheten' ],
];

export const PERIODS = 25;
export const DAYS = 15.2083333333333; // BQ37

/** Periodens startdatum: 1:a och 15:e varje månad, och 31 december. */
export function periodStart( year, p ) {
	return p === 24 ? new Date( Date.UTC( year, 11, 31 ) ) : new Date( Date.UTC( year, Math.floor( p / 2 ), p % 2 ? 15 : 1 ) );
}
/** Perioden (0–24) som ett datum (ÅÅÅÅ-MM-DD) hör till. */
export function periodOf( date ) {
	const [ , m, d ] = String( date ).split( '-' ).map( Number );
	if ( m === 12 && d === 31 ) {
		return 24;
	}
	return ( m - 1 ) * 2 + ( d >= 15 ? 1 : 0 );
}

const DEFAULTS = {
	type: 'd',
	start: 5, // kvalster 1 januari
	immigration: 1,
	workerDaughters: 1.45, // AH41
	workerViable: 0.7, // AH42
	droneDaughters: 3.5, // AH43
	droneViable: 0.7, // AH44
	mortalityBroodless: 0.005, // AH45
	mortalityBrood: 0.005, // AH46
	outgoingInfestation: 0.6, // AH47
	droneInvasion: 5, // BQ43
	invasionConstant: 5, // BQ42
	vsh: 0.05, // AH50
	cellsPerFrame: 4500, // BQ44
	beesPerFrame: 2000, // BQ45
	pupaSurvival: 0.95, // BQ47
	crashInvaded: 0.5, // AI52
	crashWash: 60, // AI53
};

const poisson0 = ( l ) => Math.exp( -l );

/**
 * Kör modellen ett år. opts: type, start, immigration, kills (25 tal 0–1, avdödning per period),
 * colony (egen samhällstyp, samma format som COLONY_TYPES.x.rows), plus parametrarna ovan.
 * Returnerar en rad per period med kvalster (mites), andel på bina (phoretic), tvättprov per 315 bin
 * (wash), procent på bina (washPct), andel angripna arbetarceller (invaded), naturligt nedfall per dygn
 * (drop), r-värde och krasch-indikator.
 */
export function runModel( opts = {} ) {
	const o = { ...DEFAULTS, ...opts };
	const rows = o.colony || ( COLONY_TYPES[ o.type ] || COLONY_TYPES.d ).rows;
	const kills = o.kills || [];
	const imm = o.immigration ? IMMIGRATION[ o.immigration ] || IMMIGRATION[ 1 ] : new Array( PERIODS ).fill( 0 );
	const mBroodless = Math.log( 1 - o.mortalityBroodless ); // BW38
	const mBrood = Math.log( 1 - o.mortalityBrood ); // BW39
	const workerR = o.workerDaughters * ( 1 - o.vsh ); // BQ30
	const out = [];
	const cohorts = []; // nya kvalster per period, för åldringen
	const oldShare = []; // andel kvalster > 75 dagar (EK60 …)
	// Avläggare och paketbin startar 1 april (period 7) med startnivån.
	const lateStart = o.type === 'n' || o.type === 'p';
	let mites = lateStart ? 0 : o.start; // DF
	let crashA = false;
	let crashB = false;

	for ( let p = 0; p < PERIODS; p++ ) {
		if ( lateStart ) {
			mites = p < 6 ? 0 : p === 6 ? o.start : mites;
		}
		const [ broodFrames, beeFrames, droneArea ] = rows[ p ];
		const prev = out[ p - 1 ];
		const prev2 = out[ p - 2 ];
		const bees = beeFrames * o.beesPerFrame; // BR
		const brood = broodFrames === 0 ? 1 : o.cellsPerFrame * broodFrames; // BT
		const ratio = bees === 0 ? 0 : brood / bees; // BU
		const daysPhoretic = ratio === 0 ? 0.001 : -o.droneInvasion * Math.log( ratio ) + o.invasionConstant; // BY
		const phoretic = broodFrames === 0 ? 1 : daysPhoretic / ( daysPhoretic + 12 ); // CA
		const inBrood = 1 - phoretic; // CB
		const mitesInBrood = mites * inBrood; // CC
		const sealed = 0.6 * brood; // CD
		const droneCells = droneArea * 16 / 25; // CF
		const droneRepro = droneCells * o.droneInvasion; // CG
		const droneShare = droneRepro * inBrood; // CH
		const droneR = Math.log( ( 1 + o.droneDaughters ) * o.pupaSurvival ) / 14.75; // CO, CP
		const workerShare = 1 - phoretic - droneShare; // CQ
		const workerCells = ( 1 - droneCells ) * sealed; // CR
		const workerMites = mitesInBrood - droneRepro * mitesInBrood; // CS
		const perCell = workerMites / workerCells; // CT
		const invaded = 1 - poisson0( perCell ); // CU
		const wR = mites > 2 * workerCells ? 0 : Math.log( ( 1 + workerR ) * o.pupaSurvival ) / 12.5; // CZ, DA
		const potential = droneShare * droneR + workerShare * wR; // DB
		const mort = ratio > 0.25 ? mBrood : mBroodless; // DC

		const mated = mites * o.workerViable; // DG
		// DH: andel som kan föröka sig. Period 2 halveras i kalkylbladet (EL5 = 0,5), därefter dras
		// andelen kvalster äldre än 75 dagar bort (från två perioder tidigare, som i bladet).
		const fertile = p === 0 ? mated : mated * ( 1 - ( p === 1 ? 0.5 : oldShare[ p - 2 ] ) );
		const gain = fertile * Math.exp( potential * DAYS ) - fertile; // DI
		const afterRepro = mites + gain; // DJ
		const afterMort = afterRepro * Math.exp( mort * DAYS ); // DL

		// Avdrift: kvalster som följer med flygbin som inte kommer tillbaka (DN), plus invandring (DM).
		const phoreticMites = mites * phoretic; // DV
		const onAdults = bees === 0 ? 0.001 : phoreticMites / bees; // DW
		let drift = 0;
		if ( p > 0 ) {
			const emerging = prev.brood * 0.9 / 20 * DAYS; // EC
			const lost = emerging - ( bees - prev.bees ); // EE
			const mult = onAdults > 0.15 ? 1 : o.outgoingInfestation; // EG
			const carried = lost * mult * onAdults; // EH
			drift = carried > phoreticMites * mult ? -phoreticMites * mult : -carried; // DN
		}
		const immigration = imm[ p ] || 0; // DM
		const beforeTreat = afterMort + immigration + ( p > 0 ? drift : 0 ); // DP
		// DQ: avdödning. Behandlingar som bara når kvalster på bina (t.ex. oxalsyra) räknas ned med
		// andelen kvalster utanför yngel, som i Randy Olivers tabell. Flera i samma period kombineras.
		let survive = 1 - Math.min( 1, Math.max( 0, kills[ p ] || 0 ) );
		// Långtidsbehandlingar (t.ex. oxalsyra/glycerin-remsor) verkar i flera perioder i rad. Behandlingar
		// som bara tar kvalster i yngel (yngeluttag, Samuel) räknas med andelen kvalster i yngel.
		( o.treatments || [] ).filter( ( t ) => p >= t.period && p < t.period + Math.max( 1, t.periods || 1 ) ).forEach( ( t ) => {
			const reach = t.phoretic ? phoretic : t.brood ? 1 - phoretic : 1;
			survive *= 1 - Math.min( 1, Math.max( 0, t.kill ) ) * reach;
		} );
		const kill = 1 - survive;
		const end = beforeTreat - beforeTreat * kill; // DS

		// Åldring: kohorter minskar med avdödning och dödlighet, äldst > 5 perioder räknas som gamla.
		cohorts.push( p === 0 ? mites : gain );
		let total = 0;
		let old = 0;
		cohorts.forEach( ( c, i ) => {
			total += c;
			if ( i <= p - 5 ) {
				old += c;
			}
		} );
		const share = total === 0 ? 0 : old / total === 1 ? 0.99 : old / total;
		oldShare.push( share );
		for ( let i = 0; i < cohorts.length; i++ ) {
			cohorts[ i ] *= ( 1 - kill ) * Math.exp( mBrood * 15 );
		}

		// Krasch: > 50 % angripna arbetarceller, eller högt tvättprov när yngelsättningen upphör.
		const wash = onAdults * 315; // DX
		if ( ! crashA && broodFrames >= 0.25 && prev2 && prev2.invaded > o.crashInvaded ) {
			crashA = true;
		}
		if ( ! crashB && brood < 100 && prev && prev2 && prev.wash + prev2.wash > o.crashWash ) {
			crashB = true;
		}

		out.push( {
			period: p,
			mites,
			r: mites > 0 && end > 0 ? Math.log( end / mites ) / DAYS : 0,
			phoretic,
			wash,
			washPct: onAdults * 100,
			invaded: brood < 5 ? null : invaded,
			drop: ( afterRepro - afterMort ) / DAYS,
			killed: beforeTreat * kill,
			kill,
			bees,
			brood,
			crashed: crashA || crashB,
		} );
		mites = end;
	}
	return out;
}

/** Vad en mätmetod motsvarar i modellen: procent på bina, eller naturligt nedfall per dygn. */
export const MEASURES = {
	Alkoholtvätt: { key: 'washPct', unit: '% av bina' },
	Sockerrullning: { key: 'washPct', unit: '% av bina' },
	'Naturligt nedfall': { key: 'drop', unit: 'kvalster/dygn' },
};

/** Modellens värde för en mätning (null om metoden inte går att jämföra). */
export function modelValue( result, m ) {
	const def = MEASURES[ m.method ];
	const row = result[ periodOf( m.date ) ];
	return def && row ? row[ def.key ] : null;
}

/**
 * Anpassar startnivån (kvalster 1 januari) så att modellen stämmer så bra som möjligt med
 * mätningarna, på logaritmisk skala (en mätning dubbelt för hög väger lika som en hälften för låg).
 */
export function fitStart( opts, measurements ) {
	const usable = measurements.filter( ( m ) => MEASURES[ m.method ] && m.value >= 0 );
	if ( ! usable.length ) {
		return null;
	}
	const err = ( s ) => {
		const r = runModel( { ...opts, start: s } );
		return usable.reduce( ( sum, m ) => {
			const v = modelValue( r, m );
			return sum + ( Math.log( v + 0.05 ) - Math.log( m.value + 0.05 ) ) ** 2;
		}, 0 );
	};
	// Gyllene snittet på log(start) mellan 0,1 och 5 000 kvalster.
	let a = Math.log( 0.1 );
	let b = Math.log( 5000 );
	const g = ( Math.sqrt( 5 ) - 1 ) / 2;
	for ( let i = 0; i < 60; i++ ) {
		const c = b - g * ( b - a );
		const d = a + g * ( b - a );
		if ( err( Math.exp( c ) ) < err( Math.exp( d ) ) ) {
			b = d;
		} else {
			a = c;
		}
	}
	return Math.exp( ( a + b ) / 2 );
}

/**
 * Hur väl behandlingarna höll. Behandlingar utan mätning emellan bedöms som en serie (t.ex. Samuel och
 * oxalsyra samma dag och sedan oxalsyra en gång i veckan): den första mätningen efter serien jämförs
 * med modellen. Mäts det mer än modellen väntar har avdödningen varit lägre än tänkt.
 * Uppskattad avdödning = 1 − (1 − väntad) × uppmätt / modell.
 */
export function checkTreatments( result, treatments, measurements ) {
	const usable = measurements.filter( ( m ) => MEASURES[ m.method ] ).map( ( m ) => ( { ...m, period: periodOf( m.date ) } ) ).sort( ( x, y ) => ( x.date < y.date ? -1 : 1 ) );
	const sorted = [ ...treatments ].sort( ( x, y ) => x.period - y.period || ( x.date < y.date ? -1 : 1 ) );
	const end = ( t ) => t.period + Math.max( 1, t.periods || 1 );
	const groups = [];
	sorted.forEach( ( t ) => {
		const g = groups[ groups.length - 1 ];
		const gEnd = g ? Math.max( ...g.items.map( end ) ) : 0;
		// Ny serie om det finns en mätning mellan förra seriens slut och den här behandlingen.
		if ( ! g || usable.some( ( m ) => m.period >= gEnd && m.period <= t.period && ! ( m.period === t.period && m.date > t.date ) ) ) {
			groups.push( { items: [ t ] } );
		} else {
			g.items.push( t );
		}
	} );
	return groups.map( ( g, i ) => {
		const first = g.items[ 0 ].period;
		const last = Math.min( PERIODS, Math.max( ...g.items.map( end ) ) );
		let left = 1;
		for ( let q = first; q < last; q++ ) {
			left *= 1 - result[ q ].kill;
		}
		const expected = 1 - left;
		const next = groups[ i + 1 ];
		const after = usable.find( ( m ) => m.period >= last && ( ! next || m.period <= next.items[ 0 ].period ) );
		if ( ! after ) {
			return { items: g.items, expected, after: null };
		}
		const model = modelValue( result, after );
		const ratio = model > 0 ? after.value / model : null;
		const actual = ratio === null ? null : Math.max( 0, Math.min( 1, 1 - ( 1 - expected ) * ratio ) );
		const verdict = ratio === null ? null : ratio <= 1.3 ? 'held' : ratio <= 2 ? 'unsure' : 'short';
		return { items: g.items, expected, after, model, ratio, actual, verdict };
	} );
}
