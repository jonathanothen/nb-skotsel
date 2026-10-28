import { useState, useMemo } from '@wordpress/element';
import { api, uuid } from '../api';
import { href } from '../router';
import { useMe } from '../App';
import { useRegister, QUEEN_ACTIVE, today, fmtDate } from '../register';
import { Loading, ErrorBox, Button, Modal, Empty, useToast } from '../ui';
import { FieldInput } from '../fields';
import { useRecords, useModules, RecordForm, SubTabs, YearSelect, Table, thisYear, fmtNum } from '../records';
import { QueenBadge, FieldsModal } from '../reg-ui';

export const CRITERIA = [
	[ 'yngel', 'Yngelbild' ],
	[ 'styrka', 'Styrka/storlek' ],
	[ 'temperament', 'Temperament' ],
	[ 'produktion', 'Produktion' ],
	[ 'rensning', 'Rensning (hygien)' ],
];

/** Viktat medelvärde 1–5 enligt vikterna i inställningarna. */
export function weighted( scores, weights ) {
	let sum = 0;
	let w = 0;
	CRITERIA.forEach( ( [ k ] ) => {
		const v = Number( scores && scores[ k ] );
		if ( v > 0 ) {
			sum += v * ( weights[ k ] || 0 );
			w += weights[ k ] || 0;
		}
	} );
	return w ? Math.round( ( sum / w ) * 100 ) / 100 : null;
}

/** Dag för dag från larvympningen (dag 0). */
export const REARING_STEPS = [
	[ -24, 'Drönarramar in i drönarsamhällena vid parningsplatsen (drönarna ska vara könsmogna vid parningen)' ],
	[ -3, 'Förbered cellbyggarsamhället: drottninglöst/startare, foder och pollen' ],
	[ 0, 'Larvympning – larver under 24 timmar från larvmodern' ],
	[ 1, 'Kontrollera antagningen, notera antal antagna celler' ],
	[ 5, 'Cellerna är täckta – stör inte' ],
	[ 10, 'Flytta cellerna till parningskupor (före kläckningen dag 11–12)' ],
	[ 12, 'Kläckning – kontrollera parningskuporna' ],
	[ 17, 'Parningsflygningar börjar (cirka dag 17–24)' ],
	[ 26, 'Kontrollera äggläggning, notera antal parade' ],
	[ 30, 'Märk drottningarna och använd dem i samhällen eller sälj' ],
];
const addDays = ( d, n ) => {
	const t = new Date( d + 'T12:00:00' );
	t.setDate( t.getDate() + n );
	return t.toISOString().slice( 0, 10 );
};

export default function Breeding( { route } ) {
	const reg = useRegister();
	const me = useMe();
	const [ modules, , reloadModules ] = useModules();
	const [ fieldsOpen, setFieldsOpen ] = useState( null );
	const tab = route[ 0 ] || 'bedomning';
	if ( reg.error ) {
		return <div className="nbs-page"><ErrorBox error={ reg.error } /></div>;
	}
	if ( reg.loading || ! modules ) {
		return <Loading />;
	}
	return (
		<div className="nbs-page">
			<header className="nbs-page-head">
				<div>
					<h1 className="nbs-h1">Avel och drottningodling</h1>
					<p className="nbs-muted">Bedömning 1–5, viktad poäng och urval av larvmödrar, odlingsserier dag för dag och dimensionering.</p>
				</div>
				<div className="nbs-row-actions">
					{ me.can.manage && tab !== 'dimensionering' && <Button variant="ghost" onClick={ () => setFieldsOpen( tab === 'serier' ? 'rearing' : 'evaluation' ) }>Egna fält</Button> }
				</div>
			</header>
			<SubTabs label="Avel" current={ tab } tabs={ [ [ 'bedomning', 'Bedömning och urval', href( 'avel' ) ], [ 'serier', 'Odlingsserier', href( 'avel/serier' ) ], [ 'dimensionering', 'Dimensionering', href( 'avel/dimensionering' ) ] ] } />
			{ tab === 'bedomning' && <Ranking modules={ modules } onSettings={ reloadModules } /> }
			{ tab === 'serier' && <Series custom={ modules.fields.rearing || [] } /> }
			{ tab === 'dimensionering' && <Dimensioning /> }
			{ fieldsOpen && <FieldsModal type={ fieldsOpen } initial={ modules.fields[ fieldsOpen ] || [] } onSaved={ reloadModules } onClose={ () => setFieldsOpen( null ) } /> }
		</div>
	);
}

/* ------------------------------------------------------------------ Bedömning och urval */

function Ranking( { modules, onSettings } ) {
	const reg = useRegister();
	const me = useMe();
	const toast = useToast();
	const [ season, setSeason ] = useState( thisYear() );
	const [ stamp, setStamp ] = useState( 0 );
	const [ evals, error ] = useRecords( 'evaluation', { season }, [ stamp ] );
	const [ health ] = useRecords( 'health', { type: 'sjukdom', year: season } );
	const [ evaluating, setEvaluating ] = useState( null );
	const [ weights, setWeights ] = useState( modules.settings.breed_weights );
	const [ editW, setEditW ] = useState( false );
	const [ share, setShare ] = useState( 10 );

	const rows = useMemo( () => {
		if ( ! evals ) {
			return [];
		}
		const by = {};
		evals.forEach( ( e ) => ( by[ e.queen_id ] = by[ e.queen_id ] || [] ).push( e ) );
		const sick = new Set( ( health || [] ).filter( ( h ) => [ 'misstanke', 'bekraftad' ].includes( h.status ) ).map( ( h ) => h.colony_id ) );
		return Object.entries( by )
			.map( ( [ qid, list ] ) => {
				const avg = {};
				CRITERIA.forEach( ( [ k ] ) => {
					const vals = list.map( ( e ) => Number( e.scores && e.scores[ k ] ) ).filter( ( v ) => v > 0 );
					avg[ k ] = vals.length ? vals.reduce( ( s, v ) => s + v, 0 ) / vals.length : null;
				} );
				const q = reg.queen[ qid ];
				const low = CRITERIA.some( ( [ k ] ) => avg[ k ] !== null && avg[ k ] <= 2 );
				const ill = q && q.colony_id && sick.has( q.colony_id );
				return { id: qid, q, avg, n: list.length, total: weighted( avg, weights ), out: low ? 'Lågt betyg (≤ 2)' : ill ? 'Sjukdom i samhället' : q && ! QUEEN_ACTIVE.includes( q.status ) ? 'Inte aktiv' : '' };
			} )
			.sort( ( a, b ) => !! a.out - !! b.out || ( b.total || 0 ) - ( a.total || 0 ) );
	}, [ evals, health, weights ] ); // eslint-disable-line react-hooks/exhaustive-deps
	const eligible = rows.filter( ( r ) => ! r.out );
	const picks = Math.max( 1, Math.ceil( ( eligible.length * share ) / 100 ) );

	const saveWeights = async () => {
		try {
			await api( 'modules', { method: 'PUT', body: { breed_weights: weights } } );
			toast( 'Vikterna sparades.' );
			setEditW( false );
			onSettings();
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};

	return (
		<>
			<div className="nbs-toolbar">
				<YearSelect value={ season } onChange={ setSeason } />
				<label className="nbs-inline-check">Larvmödrar: bästa <input type="number" min="1" max="100" value={ share } onChange={ ( e ) => setShare( Number( e.target.value ) || 10 ) } className="nbs-num-sm" /> %</label>
				<button type="button" className="nbs-link-btn" onClick={ () => setEditW( ! editW ) }>Vikter: { CRITERIA.map( ( [ k, l ] ) => `${ l.split( ' ' )[ 0 ].toLowerCase() } ${ weights[ k ] || 0 }` ).join( ', ' ) }</button>
				<span className="nbs-spacer" />
				{ me.can.write && <Button onClick={ () => setEvaluating( {} ) }>+ Bedöm drottning</Button> }
			</div>
			{ editW && (
				<div className="nbs-subform nbs-weights">
					{ CRITERIA.map( ( [ k, l ] ) => <FieldInput key={ k } field={ { key: 'w_' + k, label: l, type: 'number', min: 0 } } value={ weights[ k ] ?? 0 } onChange={ ( v ) => setWeights( ( w ) => ( { ...w, [ k ]: Number( String( v ).replace( ',', '.' ) ) || 0 } ) ) } /> ) }
					{ me.can.manage && <Button small onClick={ saveWeights }>Spara vikterna</Button> }
				</div>
			) }
			<ErrorBox error={ error } />
			{ ! evals ? <Loading /> : rows.length === 0 ? (
				<Empty title={ `Inga bedömningar ${ season }` }>
					<p>Bedöm drottningarna under säsongen (yngelbild, styrka, temperament, produktion och rensning 1–5). Med flera bedömningar räknas medelvärdet.</p>
				</Empty>
			) : (
				<Table
					rows={ rows }
					cols={ [
						[ '#', ( r ) => ( r.out ? '–' : eligible.indexOf( r ) + 1 ) ],
						[ 'Drottning', ( r ) => ( r.q ? <QueenBadge q={ r.q } /> : 'Borttagen' ) ],
						...CRITERIA.map( ( [ k, l ] ) => [ l.split( ' ' )[ 0 ], ( r ) => fmtNum( r.avg[ k ] ), 'is-num' ] ),
						[ 'Poäng', ( r ) => <strong>{ fmtNum( r.total ) }</strong>, 'is-num' ],
						[ 'Bedömningar', ( r ) => r.n, 'is-num' ],
						[ 'Urval', ( r ) => ( r.out ? <span className="nbs-muted">Utsållad: { r.out }</span> : eligible.indexOf( r ) < picks ? <span className="nbs-badge is-ok">Larvmor</span> : '' ) ],
					] }
				/>
			) }
			{ evaluating && <EvaluateModal preset={ evaluating } weights={ weights } season={ season } onClose={ () => setEvaluating( null ) } onDone={ () => setStamp( ( s ) => s + 1 ) } /> }
		</>
	);
}

export function EvaluateModal( { preset = {}, weights, season, onClose, onDone } ) {
	const reg = useRegister();
	const toast = useToast();
	const [ queen, setQueen ] = useState( preset.queen_id || '' );
	const [ date, setDate ] = useState( today() );
	const [ scores, setScores ] = useState( {} );
	const [ note, setNote ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ err, setErr ] = useState( null );
	const queens = reg.queens.filter( ( q ) => QUEEN_ACTIVE.includes( q.status ) && q.colony_id ).sort( ( a, b ) => a.code.localeCompare( b.code, 'sv', { numeric: true } ) );
	const total = weighted( scores, weights );
	const run = async () => {
		setBusy( true );
		setErr( null );
		try {
			const q = reg.queen[ queen ];
			await api( 'r/evaluation', { method: 'POST', body: { id: uuid(), queen_id: queen, colony_id: q ? q.colony_id : null, eval_date: date, season: Number( date.slice( 0, 4 ) ) || season, scores, total, note } } );
			toast( 'Bedömningen sparades.' );
			onDone();
			onClose();
		} catch ( e ) {
			setErr( e );
			setBusy( false );
		}
	};
	return (
		<Modal title="Bedöm drottning" onClose={ onClose } footer={ <><span className="nbs-muted">Viktad poäng: <strong>{ fmtNum( total ) }</strong></span><span className="nbs-spacer" /><Button variant="ghost" onClick={ onClose }>Avbryt</Button><Button onClick={ run } disabled={ busy || ! queen || total === null }>{ busy ? 'Sparar…' : 'Spara' }</Button></> }>
			<div className="nbs-form">
				<ErrorBox error={ err } />
				<div className="nbs-form-row">
					<div className="nbs-field">
						<label htmlFor="nbs-ev-q">Drottning</label>
						<select id="nbs-ev-q" value={ queen } onChange={ ( e ) => setQueen( e.target.value ) }>
							<option value="">– Välj –</option>
							{ queens.map( ( q ) => <option key={ q.id } value={ q.id }>{ q.code } – samhälle { reg.colony[ q.colony_id ] ? reg.colony[ q.colony_id ].code : '?' }</option> ) }
						</select>
					</div>
					<FieldInput field={ { key: 'ev_date', label: 'Datum', type: 'date' } } value={ date } onChange={ setDate } />
				</div>
				{ CRITERIA.map( ( [ k, l ] ) => <FieldInput key={ k } field={ { key: 'ev_' + k, label: l, type: 'scale', min: 1, max: 5 } } value={ scores[ k ] } onChange={ ( v ) => setScores( ( s ) => ( { ...s, [ k ]: v } ) ) } /> ) }
				<FieldInput field={ { key: 'ev_note', label: 'Anteckning', type: 'text' } } value={ note } onChange={ setNote } />
			</div>
		</Modal>
	);
}

/** Bedömningar på drottningens sida. */
export function QueenEvaluations( { queen } ) {
	const me = useMe();
	const [ modules ] = useModules();
	const [ stamp, setStamp ] = useState( 0 );
	const [ evals ] = useRecords( 'evaluation', { queen_id: queen.id }, [ stamp ] );
	const [ open, setOpen ] = useState( false );
	if ( ! evals || ! modules ) {
		return null;
	}
	return (
		<section className="nbs-card nbs-history">
			<div className="nbs-card-head">
				<h2 className="nbs-h2">Bedömningar</h2>
				{ me.can.write && QUEEN_ACTIVE.includes( queen.status ) && queen.colony_id && <Button small onClick={ () => setOpen( true ) }>+ Bedöm</Button> }
			</div>
			{ evals.length ? (
				<Table rows={ evals } cols={ [ [ 'Datum', ( e ) => fmtDate( e.eval_date ) ], ...CRITERIA.map( ( [ k, l ] ) => [ l.split( ' ' )[ 0 ], ( e ) => ( e.scores && e.scores[ k ] ) || '–', 'is-num' ] ), [ 'Poäng', ( e ) => <strong>{ fmtNum( e.total ) }</strong>, 'is-num' ] ] } />
			) : <p className="nbs-muted">Inte bedömd ännu.</p> }
			{ open && <EvaluateModal preset={ { queen_id: queen.id } } weights={ modules.settings.breed_weights } season={ thisYear() } onClose={ () => setOpen( false ) } onDone={ () => setStamp( ( s ) => s + 1 ) } /> }
		</section>
	);
}

/* ------------------------------------------------------------------ Odlingsserier */

function Series( { custom } ) {
	const reg = useRegister();
	const me = useMe();
	const [ stamp, setStamp ] = useState( 0 );
	const [ rows, error ] = useRecords( 'rearing', {}, [ stamp ] );
	const [ editing, setEditing ] = useState( null );
	const [ openId, setOpenId ] = useState( null );
	const fields = [
		{ key: 'name', label: 'Namn', type: 'text', required: true },
		{ key: 'graft_date', label: 'Ympningsdag (dag 0)', type: 'date' },
		{ key: 'mother_id', label: 'Larvmor', type: 'ref', ref: '@queen' },
		{ key: 'apiary_id', label: 'Parningsplats', type: 'ref', ref: '@apiary' },
		{ key: 'grafted', label: 'Ympade larver', type: 'number', min: 0 },
		{ key: 'accepted', label: 'Antagna celler', type: 'number', min: 0 },
		{ key: 'hatched', label: 'Kläckta', type: 'number', min: 0 },
		{ key: 'mated', label: 'Parade', type: 'number', min: 0 },
		{ key: 'status', label: 'Status', type: 'select', noEmpty: true, options: [ [ 'planerad', 'Planerad' ], [ 'pagar', 'Pågår' ], [ 'klar', 'Klar' ] ] },
		{ key: 'note', label: 'Anteckningar', type: 'textarea' },
	];
	const pct = ( a, b ) => ( a && b ? ` (${ Math.round( ( a / b ) * 100 ) } %)` : '' );
	if ( error ) {
		return <ErrorBox error={ error } />;
	}
	if ( ! rows ) {
		return <Loading />;
	}
	const park = reg.apiaries.find( ( a ) => /parning/i.test( a.name ) );
	return (
		<>
			<div className="nbs-toolbar">
				<span className="nbs-muted">Driftplanen: drottningodling vecka 27–29. Varje serie får en dagplan räknad från ympningen.</span>
				<span className="nbs-spacer" />
				{ me.can.write && <Button onClick={ () => setEditing( { name: `Serie ${ rows.length + 1 }`, status: 'planerad', graft_date: today(), apiary_id: park ? park.id : null } ) }>+ Ny serie</Button> }
			</div>
			{ rows.length === 0 && <Empty title="Inga odlingsserier"><p>Lägg upp en serie med ympningsdag och larvmor, så räknas dagplanen ut.</p></Empty> }
			{ rows.map( ( r ) => (
				<section key={ r.id } className="nbs-card nbs-mt">
					<div className="nbs-card-head">
						<div>
							<h2 className="nbs-h2">{ r.name } <span className={ `nbs-status is-${ r.status === 'klar' ? 'parad' : 'oparad' }` }>{ { planerad: 'Planerad', pagar: 'Pågår', klar: 'Klar' }[ r.status ] }</span></h2>
							<p className="nbs-muted">Ympning { fmtDate( r.graft_date ) }{ reg.queen[ r.mother_id ] && <> · larvmor <QueenBadge q={ reg.queen[ r.mother_id ] } /></> }{ reg.apiary[ r.apiary_id ] && ` · ${ reg.apiary[ r.apiary_id ].name }` }</p>
							<p>{ r.grafted || 0 } ympade → { r.accepted ?? '–' } antagna{ pct( r.accepted, r.grafted ) } → { r.hatched ?? '–' } kläckta{ pct( r.hatched, r.accepted ) } → { r.mated ?? '–' } parade{ pct( r.mated, r.hatched ) }</p>
						</div>
						<div className="nbs-row-actions">
							<Button small variant="ghost" onClick={ () => setOpenId( openId === r.id ? null : r.id ) }>{ openId === r.id ? 'Dölj dagplan' : 'Dagplan' }</Button>
							{ me.can.write && <Button small variant="ghost" onClick={ () => setEditing( r ) }>Redigera</Button> }
						</div>
					</div>
					{ openId === r.id && r.graft_date && (
						<ol className="nbs-dayplan">
							{ REARING_STEPS.map( ( [ d, t ] ) => {
								const date = addDays( r.graft_date, d );
								return <li key={ d } className={ date < today() ? 'is-past' : date === today() ? 'is-today' : '' }><span className="nbs-dp-day">Dag { d }</span><span className="nbs-dp-date">{ new Date( date + 'T12:00:00' ).toLocaleDateString( 'sv-SE', { weekday: 'short', day: 'numeric', month: 'short' } ) }</span><span>{ t }</span></li>;
							} ) }
						</ol>
					) }
				</section>
			) ) }
			{ editing && <RecordForm type="rearing" wide title={ editing.id ? editing.name : 'Ny odlingsserie' } fields={ fields } item={ editing.id ? editing : {} } preset={ editing.id ? {} : editing } custom={ custom } onClose={ () => setEditing( null ) } onSaved={ () => setStamp( ( s ) => s + 1 ) } /> }
		</>
	);
}

/* ------------------------------------------------------------------ Dimensionering */

/** Samma beräkning som Drottningodling_dimensionering.xlsx. */
function Dimensioning() {
	const [ v, setV ] = useState( { want: 100, accept: 85, hatch: 95, mate: 80, perColony: 30, frames: 2, series: 3 } );
	const set = ( k ) => ( x ) => setV( ( o ) => ( { ...o, [ k ]: Number( String( x ).replace( ',', '.' ) ) || 0 } ) );
	const rate = ( v.accept / 100 ) * ( v.hatch / 100 ) * ( v.mate / 100 );
	const larvae = rate ? Math.ceil( v.want / rate ) : 0;
	const perSeries = v.series ? Math.ceil( larvae / v.series ) : 0;
	const builders = v.perColony ? Math.ceil( perSeries / v.perColony ) : 0;
	const support = builders;
	const refill = support * v.frames;
	const inputs = [ [ 'want', 'Önskat antal parade drottningar' ], [ 'accept', 'Antagning (%)' ], [ 'hatch', 'Kläckning (%)' ], [ 'mate', 'Lyckad parning (%)' ], [ 'perColony', 'Larver per odlingssamhälle och omgång' ], [ 'frames', 'Krypmogna yngelramar per samhälle och vecka' ], [ 'series', 'Antal serier' ] ];
	return (
		<div className="nbs-grid">
			<section className="nbs-card">
				<h2 className="nbs-h2">Förutsättningar</h2>
				{ inputs.map( ( [ k, l ] ) => <FieldInput key={ k } field={ { key: 'd_' + k, label: l, type: 'number' } } value={ v[ k ] } onChange={ set( k ) } /> ) }
			</section>
			<section className="nbs-card">
				<h2 className="nbs-h2">Resultat</h2>
				<dl className="nbs-dl">
					<div><dt>Larver totalt</dt><dd>{ larvae }</dd></div>
					<div><dt>Larver per serie</dt><dd>{ perSeries }</dd></div>
					<div><dt>Odlingssamhällen</dt><dd>{ builders }</dd></div>
					<div><dt>Supportsamhällen</dt><dd>{ support }</dd></div>
					<div><dt>Yngelramar per påfyllning</dt><dd>{ refill }</dd></div>
					<div><dt>Yngelramar vid två påfyllningar</dt><dd>{ refill * 2 }</dd></div>
				</dl>
				<p className="nbs-muted">Total utfallsandel { fmtNum( rate * 100 ) } % (antagning × kläckning × parning).</p>
			</section>
		</div>
	);
}
