import { useMemo, useState, useEffect } from '@wordpress/element';
import { api } from '../api';
import { useRegister, fmtDate } from '../register';
import { useLoad, Loading, ErrorBox, Button } from '../ui';
import { useRecords, YearSelect, thisYear } from '../records';
import { runModel, fitStart, checkTreatments, modelValue, periodOf, periodStart, COLONY_TYPES, IMMIGRATION_LEVELS, MEASURES, PERIODS } from '../varroa-model';

const MONTHS = [ 'jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec' ];
const nf = ( v, d = 1 ) => ( v === null || v === undefined || ! isFinite( v ) ? '–' : new Intl.NumberFormat( 'sv-SE', { maximumFractionDigits: d } ).format( v ) );
const pct = ( v ) => ( v === null || v === undefined ? '–' : nf( v * 100, 0 ) + ' %' );
const ymd = ( d ) => d.toISOString().slice( 0, 10 );
const STORE = 'nbs_varroamodel';

/** Avdödning som förslag när behandlingsmedlet saknar värde (Randy Olivers tabell, ungefär). */
const DEFAULT_KILL = { Sublimering: [ 0.9, true ], Dropp: [ 0.9, true ], 'Avdunstning, lång': [ 0.9, false ], 'Avdunstning, kort': [ 0.5, false ], Remsor: [ 0.95, false ] };

/** "bara på bina", "bara i yngel", "i 3 perioder" */
const effect = ( t ) => [ t.phoretic && 'bara på bina', t.brood && 'bara i yngel', t.periods > 1 && `i ${ t.periods } perioder` ].filter( Boolean ).join( ', ' );

function treatmentKill( item, record ) {
	const d = ( item && item.data ) || {};
	const fallback = DEFAULT_KILL[ d.metod ] || [ 0.5, false ];
	const own = record && record.value !== null && record.value !== '' && isFinite( record.value ) ? Number( record.value ) / 100 : null;
	const listed = d.avdodning !== undefined && d.avdodning !== '' && d.avdodning !== null ? Number( d.avdodning ) / 100 : null;
	return {
		kill: own ?? listed ?? fallback[ 0 ],
		phoretic: d.foretisk !== undefined && d.foretisk !== null && d.foretisk !== '' ? !! d.foretisk : fallback[ 1 ],
		brood: !! d.i_yngel,
		periods: Math.max( 1, parseInt( d.perioder, 10 ) || 1 ),
		source: own !== null ? 'angiven i posten' : listed !== null ? 'från behandlingsmedlet' : 'förslag',
	};
}

const load = () => {
	try {
		return JSON.parse( window.localStorage.getItem( STORE ) ) || {};
	} catch ( e ) {
		return {};
	}
};

/**
 * Randy Olivers varroamodell för ett samhälle eller en bigård: behandlingar och mätningar från
 * Bihälsa (och besök med skötselkort) läggs in i modellen, planerade behandlingar kan provas, och
 * mätningarna jämförs med vad modellen väntar – så att man ser om behandlingarna höll.
 */
export default function VarroaModel() {
	const reg = useRegister();
	const saved = load();
	const [ year, setYear ] = useState( saved.year || thisYear() );
	const [ scope, setScope ] = useState( saved.scope || '' ); // 'c:<id>' eller 'a:<id>'
	const [ type, setType ] = useState( saved.type || 'd' );
	const [ immigration, setImmigration ] = useState( saved.immigration ?? 1 );
	const [ vsh, setVsh ] = useState( saved.vsh ?? 5 );
	const [ start, setStart ] = useState( saved.start ?? 10 );
	const [ threshold, setThreshold ] = useState( saved.threshold ?? 3 );
	const [ planned, setPlanned ] = useState( saved.planned || [] );
	const [ off, setOff ] = useState( [] );
	const [ rows ] = useRecords( 'health', { year }, [ year ] );
	const [ treatList ] = useLoad( () => api( 'lists' ).then( ( ls ) => {
		const l = ls.find( ( x ) => x.key === 'behandling' );
		return l ? api( 'lists/' + l.id ).then( ( r ) => r.items ) : [];
	} ) );

	useEffect( () => {
		try {
			window.localStorage.setItem( STORE, JSON.stringify( { year, scope, type, immigration, vsh, start, threshold, planned } ) );
		} catch ( e ) {}
	}, [ year, scope, type, immigration, vsh, start, threshold, planned ] );

	const colonies = reg.activeColonies.slice().sort( ( a, b ) => String( a.code ).localeCompare( String( b.code ), 'sv', { numeric: true } ) );
	const [ kind, id ] = scope.split( ':' );
	const inScope = ( h ) => ( kind === 'c' ? h.colony_id === id : kind === 'a' ? h.apiary_id === id || ( reg.colony[ h.colony_id ] && reg.colony[ h.colony_id ].apiary_id === id ) : false );

	const items = Object.fromEntries( ( treatList || [] ).map( ( t ) => [ t.id, t ] ) );
	const data = useMemo( () => {
		if ( ! rows || ! scope ) {
			return null;
		}
		const mine = rows.filter( inScope );
		const measurements = mine.filter( ( h ) => h.type === 'varroa' && h.value !== null && h.rec_date ).map( ( h ) => ( { id: h.id, date: h.rec_date, method: h.method, value: Number( h.value ), colony: h.colony_id } ) );
		// En behandling per datum och medel (i en bigård räknas samma behandling samma dag en gång).
		const byKey = {};
		mine.filter( ( h ) => h.type === 'behandling' && h.rec_date ).forEach( ( h ) => {
			const key = h.rec_date + ':' + ( h.treatment_id || '' );
			byKey[ key ] = byKey[ key ] || { key, period: periodOf( h.rec_date ), date: h.rec_date, name: ( items[ h.treatment_id ] && items[ h.treatment_id ].name ) || 'Behandling', n: 0, ...treatmentKill( items[ h.treatment_id ], h ) };
			byKey[ key ].n++;
		} );
		const recorded = Object.values( byKey ).sort( ( a, b ) => ( a.date < b.date ? -1 : a.date > b.date ? 1 : 0 ) );
		return { measurements, recorded };
	}, [ rows, scope, treatList ] ); // eslint-disable-line react-hooks/exhaustive-deps

	if ( ! rows || ! treatList ) {
		return <Loading />;
	}

	const plannedT = planned.filter( ( p ) => p.date && p.date.startsWith( String( year ) ) ).map( ( p, i ) => ( { key: 'p' + i, period: periodOf( p.date ), date: p.date, name: p.name || 'Planerad behandling', kill: ( Number( p.kill ) || 0 ) / 100, phoretic: !! p.phoretic, brood: !! p.brood, periods: p.periods || 1, planned: true } ) );
	const treatments = data ? [ ...data.recorded.filter( ( t ) => ! off.includes( t.key ) ), ...plannedT ] : plannedT;
	const opts = { type, immigration: Number( immigration ), vsh: ( Number( vsh ) || 0 ) / 100, start: Number( start ) || 0, treatments };
	const result = runModel( opts );
	const without = runModel( { ...opts, treatments: [] } );
	const measurements = data ? data.measurements : [];
	const checks = data ? checkTreatments( result, treatments.filter( ( t ) => ! t.planned ), measurements ) : [];
	const fit = () => {
		const s = fitStart( opts, measurements );
		if ( s ) {
			setStart( Math.round( s * 10 ) / 10 );
		}
	};
	const firstOver = result.find( ( r ) => r.washPct >= threshold );
	const peak = result.reduce( ( m, r ) => ( r.mites > m.mites ? r : m ), result[ 0 ] );
	const crash = result.find( ( r ) => r.crashed );
	const at = ( month, day ) => result[ periodOf( `${ year }-${ String( month ).padStart( 2, '0' ) }-${ day }` ) ];

	return (
		<div className="nbs-vm">
			<section className="nbs-card">
				<div className="nbs-form-row nbs-vm-controls">
					<div className="nbs-field">
						<label htmlFor="nbs-vm-scope">Samhälle eller bigård</label>
						<select id="nbs-vm-scope" value={ scope } onChange={ ( e ) => ( setScope( e.target.value ), setOff( [] ) ) }>
							<option value="">Bara modellen (inga mätningar)</option>
							<optgroup label="Bigårdar">
								{ reg.apiaries.filter( ( a ) => a.active ).map( ( a ) => <option key={ a.id } value={ 'a:' + a.id }>{ a.name }</option> ) }
							</optgroup>
							<optgroup label="Samhällen">
								{ colonies.map( ( c ) => <option key={ c.id } value={ 'c:' + c.id }>Samhälle { c.code }{ reg.apiary[ c.apiary_id ] ? ` (${ reg.apiary[ c.apiary_id ].name })` : '' }</option> ) }
							</optgroup>
						</select>
					</div>
					<div className="nbs-field">
						<label>År</label>
						<YearSelect value={ year } onChange={ setYear } />
					</div>
					<div className="nbs-field">
						<label htmlFor="nbs-vm-type">Samhällstyp</label>
						<select id="nbs-vm-type" value={ type } onChange={ ( e ) => setType( e.target.value ) }>
							{ Object.entries( COLONY_TYPES ).map( ( [ k, t ] ) => <option key={ k } value={ k }>{ t.name }</option> ) }
						</select>
					</div>
					<div className="nbs-field">
						<label htmlFor="nbs-vm-imm">Invandring av kvalster</label>
						<select id="nbs-vm-imm" value={ immigration } onChange={ ( e ) => setImmigration( e.target.value ) }>
							{ IMMIGRATION_LEVELS.map( ( [ k, l ] ) => <option key={ k } value={ k }>{ l }</option> ) }
						</select>
					</div>
					<div className="nbs-field">
						<label htmlFor="nbs-vm-start">Kvalster 1 januari</label>
						<div className="nbs-inline">
							<input id="nbs-vm-start" type="number" min="0" step="any" value={ start } onChange={ ( e ) => setStart( e.target.value ) } />
							{ measurements.some( ( m ) => MEASURES[ m.method ] ) && <Button variant="ghost" small onClick={ fit }>Anpassa efter mätningarna</Button> }
						</div>
					</div>
					<div className="nbs-field">
						<label htmlFor="nbs-vm-vsh">Hygieniskt beteende (VSH)</label>
						<div className="nbs-inline"><input id="nbs-vm-vsh" type="number" min="0" max="100" value={ vsh } onChange={ ( e ) => setVsh( e.target.value ) } /> %</div>
					</div>
					<div className="nbs-field">
						<label htmlFor="nbs-vm-thr">Behandlingströskel</label>
						<div className="nbs-inline"><input id="nbs-vm-thr" type="number" min="0" step="0.5" value={ threshold } onChange={ ( e ) => setThreshold( Number( e.target.value ) || 0 ) } /> % på bina</div>
					</div>
				</div>
			</section>

			<section className="nbs-card">
				<h2 className="nbs-h2">Kvalster i samhället</h2>
				<ul className="nbs-stats">
					<li><strong>{ nf( peak.mites, 0 ) }</strong> som mest ({ fmtDate( ymd( periodStart( year, peak.period ) ) ) })</li>
					<li><strong>{ nf( at( 8, 1 ).washPct ) } %</strong> på bina 1 augusti</li>
					<li><strong>{ nf( at( 10, 1 ).washPct ) } %</strong> på bina 1 oktober</li>
					<li><strong>{ nf( result[ PERIODS - 1 ].mites, 0 ) }</strong> vid årets slut (utan behandling { nf( without[ PERIODS - 1 ].mites, 0 ) })</li>
				</ul>
				{ firstOver && <p className="nbs-warn">Över behandlingströskeln ({ threshold } % på bina) från { fmtDate( ymd( periodStart( year, firstOver.period ) ) ) }.</p> }
				{ crash && <p className="nbs-warn">Modellen varnar för att samhället kollapsar (många angripna celler eller högt tvättprov när yngelsättningen upphör) från { fmtDate( ymd( periodStart( year, crash.period ) ) ) }.</p> }
				<Chart year={ year } series={ [ { values: without.map( ( r ) => r.mites ), cls: 'is-ghost', label: 'Utan behandling' }, { values: result.map( ( r ) => r.mites ), cls: 'is-main', label: 'Med behandlingarna' } ] } treatments={ treatments } unit="kvalster" />
				<h3 className="nbs-h3">Andel kvalster på bina (tvättprov)</h3>
				<Chart year={ year } series={ [ { values: result.map( ( r ) => r.washPct ), cls: 'is-main', label: 'Modellen' } ] } treatments={ treatments } threshold={ threshold } points={ measurements.filter( ( m ) => MEASURES[ m.method ] && MEASURES[ m.method ].key === 'washPct' ) } unit="%" />
				{ measurements.some( ( m ) => m.method === 'Naturligt nedfall' ) && (
					<>
						<h3 className="nbs-h3">Naturligt nedfall (kvalster per dygn)</h3>
						<Chart year={ year } series={ [ { values: result.map( ( r ) => r.drop ), cls: 'is-main', label: 'Modellen' } ] } treatments={ treatments } points={ measurements.filter( ( m ) => m.method === 'Naturligt nedfall' ) } unit="/dygn" />
					</>
				) }
				<p className="nbs-muted">Randy Olivers varroamodell (scientificbeekeeping.com), samma beräkning som i kalkylbladet. Modellen räknar i perioder om ca 15 dagar. Tvättprovet är andelen kvalster på de vuxna bina (alkoholtvätt eller sockerrullning).</p>
			</section>

			<section className="nbs-card">
				<h2 className="nbs-h2">Behandlingar i modellen</h2>
				{ ! scope && <p className="nbs-muted">Välj ett samhälle eller en bigård för att få med registrerade behandlingar och mätningar.</p> }
				{ data && data.recorded.length === 0 && <p className="nbs-muted">Inga registrerade behandlingar { year }.</p> }
				{ ( ( data && data.recorded.length > 0 ) || plannedT.length > 0 ) && (
					<table className="nbs-table">
						<thead><tr><th>Med</th><th>Datum</th><th>Behandling</th><th>Avdödning</th><th>Hela perioden</th></tr></thead>
						<tbody>
							{ data && data.recorded.map( ( t ) => (
								<tr key={ t.key }>
									<td><input type="checkbox" checked={ ! off.includes( t.key ) } onChange={ ( e ) => setOff( ( o ) => ( e.target.checked ? o.filter( ( k ) => k !== t.key ) : [ ...o, t.key ] ) ) } aria-label={ 'Räkna med ' + t.name } /></td>
									<td>{ fmtDate( t.date ) }</td>
									<td>{ t.name }{ kind === 'a' && t.n > 1 ? ` (${ t.n } samhällen)` : '' }</td>
									<td>{ pct( t.kill ) } <small className="nbs-muted">{ [ t.source, effect( t ) ].filter( Boolean ).join( ', ' ) }</small></td>
									<td>{ pct( result[ t.period ].kill ) }</td>
								</tr>
							) ) }
							{ plannedT.map( ( t ) => (
								<tr key={ t.key } className="is-planned">
									<td>Plan</td>
									<td>{ fmtDate( t.date ) }</td>
									<td>{ t.name }</td>
									<td>{ pct( t.kill ) }{ effect( t ) ? <small className="nbs-muted"> { effect( t ) }</small> : null }</td>
									<td>{ pct( result[ t.period ].kill ) }</td>
								</tr>
							) ) }
						</tbody>
					</table>
				) }
				<Planned year={ year } planned={ planned } setPlanned={ setPlanned } treatList={ treatList } />
			</section>

			{ scope && (
				<section className="nbs-card">
					<h2 className="nbs-h2">Håller det?</h2>
					{ checks.length > 0 && (
						<table className="nbs-table">
							<thead><tr><th>Behandlingar</th><th>Väntad avdödning</th><th>Mätning efter</th><th>Modellen väntar</th><th>Bedömning</th></tr></thead>
							<tbody>
								{ checks.map( ( c ) => (
									<tr key={ c.items.map( ( t ) => t.key ).join() }>
										<td>
											{ fmtDate( c.items[ 0 ].date ) }{ c.items.length > 1 ? ` – ${ fmtDate( c.items[ c.items.length - 1 ].date ) }` : '' }
											<br /><small className="nbs-muted">{ summarize( c.items ) }</small>
										</td>
										<td>{ pct( c.expected ) }</td>
										<td>{ c.after ? `${ nf( c.after.value ) } ${ MEASURES[ c.after.method ].unit } (${ fmtDate( c.after.date ) })` : <span className="nbs-muted">Ingen mätning efter</span> }</td>
										<td>{ c.after ? nf( c.model ) : '–' }</td>
										<td>{ c.verdict ? <Verdict c={ c } /> : '–' }</td>
									</tr>
								) ) }
							</tbody>
						</table>
					) }
					{ measurements.length > 0 ? (
						<table className="nbs-table">
							<thead><tr><th>Datum</th><th>Mätning</th><th>Uppmätt</th><th>Modellen</th><th>Jämfört</th></tr></thead>
							<tbody>
								{ measurements.slice().sort( ( a, b ) => ( a.date < b.date ? -1 : 1 ) ).map( ( m ) => {
									const v = modelValue( result, m );
									const ratio = v ? m.value / v : null;
									return (
										<tr key={ m.id }>
											<td>{ fmtDate( m.date ) }</td>
											<td>{ m.method }{ kind === 'a' && reg.colony[ m.colony ] ? `, samhälle ${ reg.colony[ m.colony ].code }` : '' }</td>
											<td>{ nf( m.value ) }</td>
											<td>{ v === null ? <span className="nbs-muted">Går inte att jämföra</span> : nf( v ) }</td>
											<td>{ ratio === null ? '–' : ratio > 2 ? <span className="nbs-badge is-low">{ nf( ratio ) } ggr högre</span> : ratio < 0.5 ? <span className="nbs-badge">{ nf( 1 / ratio ) } ggr lägre</span> : <span className="nbs-badge is-ok">Stämmer</span> }</td>
										</tr>
									);
								} ) }
							</tbody>
						</table>
					) : <p className="nbs-muted">Inga varroamätningar { year }. Registrera i Bihälsa, eller koppla ett fält i skötselkortet till en varroamätning.</p> }
					<p className="nbs-muted">Mäts det mer än modellen väntar efter en behandling har den tagit färre kvalster än tänkt (eller så har det kommit in kvalster utifrån). Använd "Anpassa efter mätningarna" först, så att startnivån stämmer med mätningarna före behandlingen.</p>
				</section>
			) }
		</div>
	);
}

/** "Oxalsyra, sublimering × 4, Samuel" */
function summarize( items ) {
	const count = {};
	items.forEach( ( t ) => ( count[ t.name ] = ( count[ t.name ] || 0 ) + 1 ) );
	return Object.entries( count ).map( ( [ n, k ] ) => ( k > 1 ? `${ n } × ${ k }` : n ) ).join( ', ' );
}

function Verdict( { c } ) {
	const label = { held: 'Höll', unsure: 'Osäkert', short: 'Lägre än väntat' }[ c.verdict ];
	const cls = { held: ' is-ok', unsure: '', short: ' is-low' }[ c.verdict ];
	return (
		<>
			<span className={ 'nbs-badge' + cls }>{ label }</span>
			<br /><small className="nbs-muted">ca { pct( c.actual ) } avdödning, mätningen { nf( c.ratio ) } × modellen</small>
		</>
	);
}

/** Planerade behandlingar som bara finns i modellen, för att prova olika upplägg. */
function Planned( { year, planned, setPlanned, treatList } ) {
	const [ date, setDate ] = useState( `${ year }-08-15` );
	const [ item, setItem ] = useState( '' );
	const [ kill, setKill ] = useState( 90 );
	const [ phoretic, setPhoretic ] = useState( false );
	const [ extra, setExtra ] = useState( { brood: false, periods: 1 } );
	const pick = ( id ) => {
		setItem( id );
		const t = treatList.find( ( x ) => x.id === id );
		if ( t ) {
			const k = treatmentKill( t, null );
			setKill( Math.round( k.kill * 100 ) );
			setPhoretic( k.phoretic );
			setExtra( { brood: k.brood, periods: k.periods } );
		}
	};
	const add = () => {
		const t = treatList.find( ( x ) => x.id === item );
		setPlanned( ( p ) => [ ...p, { date, name: t ? t.name : 'Behandling', kill, phoretic, ...extra } ] );
	};
	const mine = planned.map( ( p, i ) => ( { ...p, i } ) ).filter( ( p ) => p.date && p.date.startsWith( String( year ) ) );
	return (
		<div className="nbs-vm-plan">
			<h3 className="nbs-h3">Prova en behandling</h3>
			<div className="nbs-form-row">
				<div className="nbs-field"><label htmlFor="nbs-vm-pd">Datum</label><input id="nbs-vm-pd" type="date" value={ date } onChange={ ( e ) => setDate( e.target.value ) } /></div>
				<div className="nbs-field">
					<label htmlFor="nbs-vm-pi">Behandlingsmedel</label>
					<select id="nbs-vm-pi" value={ item } onChange={ ( e ) => pick( e.target.value ) }>
						<option value="">Eget värde</option>
						{ treatList.map( ( t ) => <option key={ t.id } value={ t.id }>{ t.name }</option> ) }
					</select>
				</div>
				<div className="nbs-field"><label htmlFor="nbs-vm-pk">Avdödning</label><div className="nbs-inline"><input id="nbs-vm-pk" type="number" min="0" max="100" value={ kill } onChange={ ( e ) => setKill( e.target.value ) } /> %</div></div>
			</div>
			<label className="nbs-check"><input type="checkbox" checked={ phoretic } onChange={ ( e ) => setPhoretic( e.target.checked ) } /> Verkar bara på kvalster på bina (t.ex. oxalsyra – lägre effekt när det finns yngel)</label>
			<div className="nbs-row-actions">
				<Button variant="ghost" onClick={ add } disabled={ ! date.startsWith( String( year ) ) }>Lägg till i modellen</Button>
				{ mine.length > 0 && <Button variant="ghost" onClick={ () => setPlanned( ( p ) => p.filter( ( x ) => ! ( x.date || '' ).startsWith( String( year ) ) ) ) }>Ta bort planerade</Button> }
			</div>
		</div>
	);
}

/** Enkelt linjediagram över årets 25 perioder, med behandlingar, tröskel och mätpunkter. */
function Chart( { year, series, treatments = [], threshold, points = [], unit } ) {
	const W = 720;
	const H = 220;
	const L = 48;
	const B = 24;
	const T = 10;
	const max = Math.max( 1, ...series.flatMap( ( s ) => s.values ), ...points.map( ( p ) => p.value ), threshold || 0 ) * 1.1;
	const x = ( p ) => L + ( p / ( PERIODS - 1 ) ) * ( W - L - 10 );
	const xDate = ( d ) => {
		const p = periodOf( d );
		const s = periodStart( year, p ).getTime();
		const e = p < PERIODS - 1 ? periodStart( year, p + 1 ).getTime() : s + 864e5;
		return x( p + Math.min( 1, ( new Date( d + 'T00:00:00Z' ).getTime() - s ) / ( e - s ) ) );
	};
	const y = ( v ) => T + ( H - T - B ) * ( 1 - v / max );
	const ticks = [ 0, 0.25, 0.5, 0.75, 1 ].map( ( f ) => max / 1.1 * f );
	return (
		<svg className="nbs-vm-chart" viewBox={ `0 0 ${ W } ${ H }` } role="img" aria-label={ series.map( ( s ) => s.label ).join( ', ' ) }>
			{ ticks.map( ( t ) => (
				<g key={ t }>
					<line x1={ L } x2={ W - 10 } y1={ y( t ) } y2={ y( t ) } className="nbs-vm-grid" />
					<text x={ L - 6 } y={ y( t ) + 4 } textAnchor="end">{ nf( t, t < 10 ? 1 : 0 ) }</text>
				</g>
			) ) }
			{ MONTHS.map( ( m, i ) => <text key={ m } x={ x( i * 2 ) } y={ H - 6 }>{ m }</text> ) }
			{ treatments.map( ( t ) => <line key={ t.key } x1={ x( t.period + 0.5 ) } x2={ x( t.period + 0.5 ) } y1={ T } y2={ H - B } className={ 'nbs-vm-treat' + ( t.planned ? ' is-planned' : '' ) }><title>{ t.name }</title></line> ) }
			{ threshold ? <line x1={ L } x2={ W - 10 } y1={ y( threshold ) } y2={ y( threshold ) } className="nbs-vm-thr"><title>Behandlingströskel { threshold } %</title></line> : null }
			{ series.map( ( s ) => <polyline key={ s.label } className={ 'nbs-vm-line ' + s.cls } points={ s.values.map( ( v, i ) => `${ x( i ) },${ y( v ) }` ).join( ' ' ) }><title>{ s.label }</title></polyline> ) }
			{ points.map( ( p ) => <circle key={ p.id } cx={ xDate( p.date ) } cy={ y( p.value ) } r="5" className="nbs-vm-point"><title>{ `${ p.date }: ${ nf( p.value ) } ${ unit }` }</title></circle> ) }
		</svg>
	);
}
