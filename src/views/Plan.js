import { useState, useMemo } from '@wordpress/element';
import { api } from '../api';
import { href, go } from '../router';
import { useMe } from '../App';
import { useRegister, today } from '../register';
import { useLoad, Loading, ErrorBox, Button, Empty, Modal, useToast } from '../ui';
import { useRecords, useModules, RecordForm, SubTabs, YearSelect, thisYear, saveRecord } from '../records';
import { FieldsModal } from '../reg-ui';

/* ISO-veckor */
export function mondayOf( year, week ) {
	const jan4 = new Date( Date.UTC( year, 0, 4 ) );
	const day = jan4.getUTCDay() || 7;
	return new Date( jan4.getTime() + ( ( week - 1 ) * 7 - ( day - 1 ) ) * 864e5 );
}
export function isoWeek( d = new Date() ) {
	const t = new Date( Date.UTC( d.getFullYear(), d.getMonth(), d.getDate() ) );
	const day = t.getUTCDay() || 7;
	t.setUTCDate( t.getUTCDate() + 4 - day );
	const y0 = new Date( Date.UTC( t.getUTCFullYear(), 0, 1 ) );
	return Math.ceil( ( ( t - y0 ) / 864e5 + 1 ) / 7 );
}
const ymd = ( d ) => d.toISOString().slice( 0, 10 );
const MONTHS = [ 'Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec' ];

/** Bigårdar som en aktivitet gäller: alla, vissa typer, vissa slingor eller utvalda. */
export function scopeApiaries( reg, scope ) {
	const s = scope || { all: true };
	return reg.apiaries.filter( ( a ) => {
		if ( ! a.active ) {
			return false;
		}
		if ( s.all !== false && ! ( s.routes || [] ).length && ! ( s.types || [] ).length && ! ( s.apiaries || [] ).length ) {
			return true;
		}
		return ( s.routes || [] ).includes( a.route_id ) || ( s.types || [] ).includes( a.type_id ) || ( s.apiaries || [] ).includes( a.id );
	} );
}

export default function Plan( { route } ) {
	const reg = useRegister();
	const me = useMe();
	const toast = useToast();
	const [ year, setYear ] = useState( thisYear() );
	const [ stamp, setStamp ] = useState( 0 );
	const [ plan, error, reload ] = useRecords( 'plan', {}, [ stamp ] );
	const [ templates ] = useLoad( () => api( 'templates' ) );
	const [ modules, , reloadModules ] = useModules();
	const [ editing, setEditing ] = useState( null );
	const [ fieldsOpen, setFieldsOpen ] = useState( false );
	const [ picking, setPicking ] = useState( false );
	const [ catalog ] = useLoad( () => api( 'dragkalender' ) );
	const tab = route[ 0 ] || 'ar';

	if ( reg.error || error ) {
		return <div className="nbs-page"><ErrorBox error={ reg.error || error } /></div>;
	}
	if ( reg.loading || ! plan || ! templates || ! modules ) {
		return <Loading />;
	}
	const importPlan = async () => {
		try {
			const r = await api( 'plan/import', { method: 'POST' } );
			toast( r.added ? `${ r.added } rader lades in från driftplanen.` : 'Driftplanen fanns redan.' );
			reload();
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	const toggleDone = async ( p, done ) => {
		try {
			await api( `plan/${ p.id }/done`, { method: 'POST', body: { year, done } } );
			reload();
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};

	return (
		<div className="nbs-page">
			<header className="nbs-page-head">
				<div>
					<h1 className="nbs-h1">Driftplan</h1>
					<p className="nbs-muted">Biodlingsåret vecka för vecka. Aktiviteter med skötselkort blir besök per bigård.</p>
				</div>
				<div className="nbs-row-actions">
					<YearSelect value={ year } onChange={ setYear } />
					{ me.can.manage && <Button variant="ghost" onClick={ () => setFieldsOpen( true ) }>Egna fält</Button> }
					{ me.can.write && <Button variant="ghost" onClick={ () => setPicking( true ) }>+ Drag</Button> }
					{ me.can.write && <Button onClick={ () => setEditing( { kind: 'activity', week_start: isoWeek(), week_end: isoWeek(), scope: { all: true } } ) }>+ Aktivitet</Button> }
				</div>
			</header>
			<SubTabs label="Driftplan" current={ tab } tabs={ [ [ 'ar', 'Årsplan', href( 'driftplan' ) ], [ 'vecka', 'Veckans arbete', href( 'driftplan/vecka' ) ] ] } />
			{ plan.length > 0 && ! plan.some( ( p ) => p.kind !== 'drag' ) && me.can.manage && (
				<p className="nbs-muted">Inga aktiviteter än. <button type="button" className="nbs-link-btn" onClick={ importPlan }>Lägg in driftplanen från driftplan.xlsx</button> eller lägg till egna med "+ Aktivitet".</p>
			) }
			{ plan.length === 0 ? (
				<Empty title="Driftplanen är tom">
					<p>Lägg in driftplanen från driftplan.xlsx – 35 aktiviteter med kategorier, veckor, rutinstatus och kopplade skötselkort. Allt kan ändras efteråt. Dragen vid dina bigårdar lägger du till själv med "+ Drag".</p>
					{ me.can.manage && <Button onClick={ importPlan }>Lägg in driftplanen</Button> }
				</Empty>
			) : tab === 'vecka' ? (
				<WeekView plan={ plan } year={ year } templates={ templates } catalog={ catalog } onDone={ toggleDone } />
			) : (
				<YearView plan={ plan } year={ year } templates={ templates } catalog={ catalog } onOpen={ setEditing } onDone={ toggleDone } />
			) }
			{ editing && <PlanForm item={ editing } templates={ templates } custom={ modules.fields.plan || [] } onClose={ () => setEditing( null ) } onSaved={ () => setStamp( ( s ) => s + 1 ) } /> }
			{ picking && <DragPicker catalog={ catalog } plan={ plan } onClose={ () => setPicking( false ) } onSaved={ () => setStamp( ( s ) => s + 1 ) } /> }
			{ fieldsOpen && <FieldsModal type="plan" initial={ modules.fields.plan || [] } onSaved={ reloadModules } onClose={ () => setFieldsOpen( false ) } /> }
		</div>
	);
}

/* ------------------------------------------------------------------ Årsplan */

function YearView( { plan, year, templates, catalog, onOpen, onDone } ) {
	const plant = plantOf( catalog );
	const reg = useRegister();
	const me = useMe();
	const [ cat, setCat ] = useState( '' );
	const [ showDrag, setShowDrag ] = useState( true );
	const now = year === thisYear() ? isoWeek() : null;
	const tpl = Object.fromEntries( templates.map( ( t ) => [ t.id, t ] ) );
	// Månadsetiketter: veckan där månaden börjar.
	const monthStarts = MONTHS.map( ( m, i ) => ( { m, w: isoWeek( new Date( year, i, 4 ) ) } ) );
	const groups = useMemo( () => {
		// Aktiviteterna först; dragkalendern sist och ihopfälld.
		const g = [];
		const acts = plan.filter( ( p ) => p.kind !== 'drag' && ( ! cat || p.category_id === cat ) );
		const cats = [ ...new Set( acts.map( ( p ) => p.category_id || '' ) ) ];
		cats.forEach( ( c ) => g.push( [ reg.itemName( c ) || 'Utan kategori', reg.itemColor( c ) || '#A8741A', acts.filter( ( p ) => ( p.category_id || '' ) === c ).sort( ( a, b ) => a.week_start - b.week_start ) ] ) );
		if ( ! cat ) {
			g.push( [ 'Drag vid bigårdarna', '#4A8A5A', plan.filter( ( p ) => p.kind === 'drag' ).sort( ( a, b ) => a.week_start - b.week_start ), true ] );
		}
		return g;
	}, [ plan, cat ] ); // eslint-disable-line react-hooks/exhaustive-deps
	const cats = [ ...new Set( plan.filter( ( p ) => p.kind !== 'drag' ).map( ( p ) => p.category_id ).filter( Boolean ) ) ];
	const col = ( w ) => `${ w + 1 }`;

	return (
		<>
			<div className="nbs-toolbar">
				<select value={ cat } onChange={ ( e ) => setCat( e.target.value ) } aria-label="Kategori">
					<option value="">Alla kategorier</option>
					{ cats.map( ( c ) => <option key={ c } value={ c }>{ reg.itemName( c ) }</option> ) }
				</select>
				<span className="nbs-muted">{ now ? `Vecka ${ now } är markerad.` : '' } Klicka på en rad för att ändra den.</span>
			</div>
			<div className="nbs-gantt-wrap">
				<div className="nbs-gantt">
					<div className="nbs-gantt-head">
						<div className="nbs-gantt-label" />
						{ monthStarts.map( ( { m, w } ) => <span key={ m } className="nbs-gantt-month" style={ { gridColumn: col( w ) } }>{ m }</span> ) }
						{ now && <span className="nbs-gantt-now" style={ { gridColumn: col( now ) } } title={ `Vecka ${ now }` } /> }
					</div>
					<div className="nbs-gantt-weeks">
						<div className="nbs-gantt-label" />
						{ Array.from( { length: 52 }, ( _, i ) => <span key={ i } className={ i + 1 === now ? 'is-now' : '' }>{ i + 1 }</span> ) }
					</div>
					{ groups.map( ( [ name, color, rows, foldable ] ) => rows.length > 0 && (
						<div key={ name } className="nbs-gantt-group">
							<div className="nbs-gantt-gname" style={ { '--c': color } }>
								{ name }
								{ foldable && <button type="button" className="nbs-link-btn" onClick={ () => setShowDrag( ( v ) => ! v ) } aria-expanded={ showDrag }>{ showDrag ? 'Dölj' : `Visa (${ rows.length })` }</button> }
							</div>
							{ ( ! foldable || showDrag ) && rows.map( ( p ) => {
								const done = p.done && p.done[ year ];
								const t = tpl[ p.template_id ];
								return (
									<div key={ p.id } className={ `nbs-gantt-row${ done ? ' is-done' : '' }` }>
										<div className="nbs-gantt-label">
											{ p.kind !== 'drag' && me.can.write && <input type="checkbox" checked={ !! done } onChange={ ( e ) => onDone( p, e.target.checked ) } aria-label={ `Klar ${ year }: ${ p.name }` } title={ done ? `Klar ${ done.at } (${ done.by })` : `Markera som klar ${ year }` } /> }
											<button type="button" className="nbs-link-btn" onClick={ () => onOpen( p ) }>{ p.name }</button>
											<span className="nbs-gantt-meta">
												{ p.status_id && <span className="nbs-chip" style={ { '--c': reg.itemColor( p.status_id ) || '#999' } }>{ reg.itemName( p.status_id ) }</span> }
												{ t && <a href={ href( 'besok/kort/' + t.id ) } className="nbs-chip is-card">{ t.name }</a> }
												{ p.kind !== 'drag' && p.owner && <span className="nbs-muted">{ p.owner }</span> }
												{ p.kind === 'drag' && <DragMeta plant={ plant( p ) } scope={ p.scope } /> }
											</span>
										</div>
										<button type="button" className="nbs-gantt-bar" style={ { gridColumn: `${ col( p.week_start ) } / ${ Number( col( p.week_end ) ) + 1 }`, background: p.kind === 'drag' ? ( plant( p ) && plant( p ).color ) || '#4A8A5A' : color } } onClick={ () => onOpen( p ) } title={ `${ p.name }, v. ${ p.week_start }–${ p.week_end }` } aria-label={ `${ p.name }, vecka ${ p.week_start } till ${ p.week_end }` } />
										{ now && <span className="nbs-gantt-nowline" style={ { gridColumn: col( now ) } } /> }
									</div>
								);
							} ) }
						</div>
					) ) }
				</div>
			</div>
		</>
	);
}

/* ------------------------------------------------------------------ Veckans arbete */

function WeekView( { plan, year, templates, catalog, onDone } ) {
	const reg = useRegister();
	const me = useMe();
	const toast = useToast();
	const [ week, setWeek ] = useState( year === thisYear() ? isoWeek() : 15 );
	const [ stamp, setStamp ] = useState( 0 );
	const [ visits, error ] = useLoad( () => api( `visits?since=${ year }-01-01&until=${ year }-12-31&limit=500` ), [ year, stamp ] );
	const tpl = Object.fromEntries( templates.map( ( t ) => [ t.id, t ] ) );
	const mon = mondayOf( year, week );
	const sun = new Date( mon.getTime() + 6 * 864e5 );
	const acts = plan.filter( ( p ) => p.kind !== 'drag' && week >= p.week_start && week <= p.week_end ).sort( ( a, b ) => !! b.template_id - !! a.template_id || a.week_start - b.week_start );
	const drag = plan.filter( ( p ) => p.kind === 'drag' && week >= p.week_start && week <= p.week_end );

	const create = async ( p, apiaryIds ) => {
		// Datum: i dag om veckan pågår, annars veckans måndag.
		const d = today() >= ymd( mon ) && today() <= ymd( sun ) ? today() : ymd( mon );
		try {
			const r = await api( 'visits', { method: 'POST', body: { template_id: p.template_id, date: d, apiary_ids: apiaryIds } } );
			toast( `${ r.ids.length } besök planerades.` );
			setStamp( ( s ) => s + 1 );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	const route = ( ids ) => {
		try {
			const cur = JSON.parse( localStorage.getItem( 'nbs_rutt' ) || '{}' ) || {};
			localStorage.setItem( 'nbs_rutt', JSON.stringify( { ...cur, stops: ids } ) );
		} catch ( e ) {
			/* privat läge */
		}
		go( 'bigardar/rutt' );
	};

	return (
		<>
			<div className="nbs-weeknav">
				<Button small variant="ghost" onClick={ () => setWeek( ( w ) => Math.max( 1, w - 1 ) ) } aria-label="Föregående vecka">←</Button>
				<strong>Vecka { week }</strong>
				<span className="nbs-muted">{ mon.toLocaleDateString( 'sv-SE', { day: 'numeric', month: 'short' } ) } – { sun.toLocaleDateString( 'sv-SE', { day: 'numeric', month: 'short' } ) } { year }</span>
				<Button small variant="ghost" onClick={ () => setWeek( ( w ) => Math.min( 52, w + 1 ) ) } aria-label="Nästa vecka">→</Button>
				{ year === thisYear() && week !== isoWeek() && <button type="button" className="nbs-link-btn" onClick={ () => setWeek( isoWeek() ) }>Denna vecka</button> }
			</div>
			{ drag.length > 0 && <p className="nbs-muted">Drag nu: { drag.map( ( d ) => d.name + scopeText( reg, d.scope ) ).join( ', ' ) }</p> }
			<ErrorBox error={ error } />
			{ ! visits && ! error && <Loading /> }
			{ visits && acts.length === 0 && <Empty title="Inget planerat den här veckan" /> }
			{ visits && acts.map( ( p ) => {
				const done = p.done && p.done[ year ];
				const t = tpl[ p.template_id ];
				const from = ymd( mondayOf( year, p.week_start ) );
				const to = ymd( new Date( mondayOf( year, p.week_end ).getTime() + 6 * 864e5 ) );
				const vis = t ? visits.filter( ( v ) => v.template_id === t.id && v.date >= from && v.date <= to ) : [];
				const state = ( id ) => {
					const v = vis.filter( ( x ) => x.apiary_id === id );
					return v.some( ( x ) => x.status === 'done' ) ? 'done' : v.length ? 'planned' : 'missing';
				};
				const aps = t ? scopeApiaries( reg, p.scope ) : [];
				const groups = {};
				aps.forEach( ( a ) => ( groups[ a.route_id || '' ] = groups[ a.route_id || '' ] || [] ).push( a ) );
				const missing = aps.filter( ( a ) => state( a.id ) === 'missing' );
				return (
					<section key={ p.id } className={ `nbs-card nbs-week-act${ done ? ' is-done' : '' }` } style={ { '--nbs-accent': reg.itemColor( p.category_id ) || '#A8741A' } }>
						<div className="nbs-card-head">
							<div>
								<p className="nbs-eyebrow">{ reg.itemName( p.category_id ) || 'Aktivitet' } · v. { p.week_start }–{ p.week_end }{ p.owner ? ` · ${ p.owner }` : '' }</p>
								<h2 className="nbs-h2">{ p.name }</h2>
								{ p.note && <p className="nbs-muted">{ p.note }</p> }
							</div>
							{ me.can.write && <label className="nbs-inline-check"><input type="checkbox" checked={ !! done } onChange={ ( e ) => onDone( p, e.target.checked ) } /> Klar { year }</label> }
						</div>
						{ t && (
							<>
								<p><a href={ href( 'besok/kort/' + t.id ) }>Skötselkort: { t.name }</a> · { aps.length - missing.length } av { aps.length } bigårdar har besök</p>
								{ Object.entries( groups ).map( ( [ rid, arr ] ) => {
									const miss = arr.filter( ( a ) => state( a.id ) === 'missing' );
									return (
										<div key={ rid || 'none' } className="nbs-week-route">
											<strong>{ rid ? reg.itemName( rid ) : 'Utan slinga' }</strong>
											<div className="nbs-week-aps">
												{ arr.map( ( a ) => {
													const s = state( a.id );
													const v = vis.find( ( x ) => x.apiary_id === a.id );
													return v ? <a key={ a.id } href={ href( 'besok/' + v.id ) } className={ `nbs-ap-chip is-${ s }` }>{ a.name }</a> : <span key={ a.id } className="nbs-ap-chip is-missing">{ a.name }</span>;
												} ) }
											</div>
											<span className="nbs-week-btns">
												{ me.can.write && miss.length > 0 && <Button small variant="ghost" onClick={ () => create( p, miss.map( ( a ) => a.id ) ) }>Skapa { miss.length } besök</Button> }
												<Button small variant="ghost" onClick={ () => route( arr.map( ( a ) => a.id ) ) }>Planera körning</Button>
											</span>
										</div>
									);
								} ) }
							</>
						) }
					</section>
				);
			} ) }
			<p className="nbs-legend-line"><span className="nbs-ap-chip is-done">Klart</span> <span className="nbs-ap-chip is-planned">Planerat</span> <span className="nbs-ap-chip is-missing">Saknar besök</span></p>
		</>
	);
}

/* ------------------------------------------------------------------ Formulär */

function ScopeField( { form, set } ) {
	const reg = useRegister();
	const s = form.scope || { all: true };
	const mode = ( s.routes || [] ).length ? 'routes' : ( s.types || [] ).length ? 'types' : ( s.apiaries || [] ).length ? 'apiaries' : 'all';
	const [ m, setM ] = useState( mode );
	const pick = ( key, id ) => {
		const cur = s[ key ] || [];
		set( 'scope', { all: false, [ key ]: cur.includes( id ) ? cur.filter( ( x ) => x !== id ) : [ ...cur, id ] } );
	};
	const opts = { routes: reg.refs.slingor || [], types: reg.refs.bigardstyper || [], apiaries: reg.apiaries.filter( ( a ) => a.active ) };
	return (
		<div className="nbs-field">
			<label>Gäller bigårdar</label>
			<select value={ m } onChange={ ( e ) => {
				setM( e.target.value );
				set( 'scope', e.target.value === 'all' ? { all: true } : { all: false } );
			} }>
				<option value="all">Alla aktiva bigårdar</option>
				<option value="routes">Vissa slingor</option>
				<option value="types">Vissa typer av bigårdar</option>
				<option value="apiaries">Utvalda bigårdar</option>
			</select>
			{ m !== 'all' && (
				<div className="nbs-checks">
					{ opts[ m ].map( ( o ) => {
						const on = ( s[ m ] || [] ).includes( o.id );
						return <label key={ o.id } className={ `nbs-check-pill${ on ? ' is-on' : '' }` }><input type="checkbox" checked={ on } onChange={ () => pick( m, o.id ) } />{ o.name }</label>;
					} ) }
				</div>
			) }
		</div>
	);
}

function PlanForm( { item, templates, custom, onClose, onSaved } ) {
	const fields = [
		{ key: 'name', label: 'Aktivitet', type: 'text', required: true, wide: true },
		{ key: 'kind', label: 'Typ', type: 'select', noEmpty: true, options: [ [ 'activity', 'Aktivitet' ], [ 'drag', 'Drag (dragkalendern)' ] ] },
		{ key: 'category_id', label: 'Kategori', type: 'ref', ref: 'kategorier', when: ( f ) => f.kind !== 'drag' },
		{ key: 'week_start', label: 'Startvecka', type: 'number', min: 1, max: 53 },
		{ key: 'week_end', label: 'Slutvecka', type: 'number', min: 1, max: 53 },
		{ key: 'owner', label: 'Ansvarig', type: 'text', when: ( f ) => f.kind !== 'drag' },
		{ key: 'status_id', label: 'Rutinstatus', type: 'ref', ref: 'rutinstatus', when: ( f ) => f.kind !== 'drag' },
		{ key: 'template_id', label: 'Skötselkort', type: 'select', options: templates.filter( ( t ) => ! t.archived ).map( ( t ) => [ t.id, t.name ] ), help: 'Med ett skötselkort kan aktiviteten bli besök per bigård under Veckans arbete.', when: ( f ) => f.kind !== 'drag' },
		{ key: 'scope', label: 'Gäller', wide: true, when: ( f ) => f.kind === 'drag' || f.template_id, render: ( form, set ) => <ScopeField form={ form } set={ set } /> },
		{ key: 'note', label: 'Kommentar', type: 'textarea' },
	];
	return <RecordForm type="plan" wide title={ item.id ? item.name : 'Ny aktivitet' } fields={ fields } item={ item.id ? item : {} } preset={ item.id ? {} : item } custom={ custom } onClose={ onClose } onSaved={ onSaved } />;
}

/* ------------------------------------------------------------------ Drag från dragkalendern */

const LEVEL = [ '', 'lite', 'bra', 'mycket bra' ];

/** Växten i dragkalendern som en dragrad hör till (source = nbd:<slug>). */
const plantOf = ( catalog ) => {
	const by = Object.fromEntries( ( ( catalog && catalog.plants ) || [] ).map( ( pl ) => [ 'nbd:' + pl.slug, pl ] ) );
	return ( p ) => by[ p.source ] || null;
};

/** "(Gäddviken, Österbo)" för drag som bara gäller vissa bigårdar. */
function scopeText( reg, scope ) {
	if ( ! scope || scope.all !== false ) {
		return '';
	}
	const names = scopeApiaries( reg, scope ).map( ( a ) => a.name );
	return names.length ? ` (${ names.join( ', ' ) })` : '';
}

function DragMeta( { plant, scope } ) {
	const reg = useRegister();
	const where = scopeText( reg, scope ).replace( /^ \(|\)$/g, '' );
	return (
		<>
			{ plant && plant.nectar > 0 && <span className="nbs-chip" style={ { '--c': '#D99A2B' } } title="Nektar">Nektar { LEVEL[ plant.nectar ] }</span> }
			{ plant && plant.pollen > 0 && <span className="nbs-chip" style={ { '--c': '#C8963D' } } title="Pollen">Pollen { LEVEL[ plant.pollen ] }</span> }
			{ plant && plant.honeydew > 0 && <span className="nbs-chip" style={ { '--c': '#6B8E4E' } } title="Honungsdagg">Honungsdagg</span> }
			<span className="nbs-muted">{ where || 'Alla bigårdar' }</span>
		</>
	);
}

/**
 * Lägg till drag: sök bland växterna i dragkalendern och välj de som finns vid bigårdarna.
 * Veckorna kommer från dragkalendern och kan ändras på raden efteråt.
 */
function DragPicker( { catalog, plan, onClose, onSaved } ) {
	const toast = useToast();
	const [ q, setQ ] = useState( '' );
	const [ picked, setPicked ] = useState( [] );
	const [ form, setForm ] = useState( { scope: { all: true } } );
	const [ busy, setBusy ] = useState( false );
	const have = new Set( plan.filter( ( p ) => p.kind === 'drag' && p.source ).map( ( p ) => p.source.replace( /^nbd:/, '' ) ) );
	if ( ! catalog ) {
		return <Modal title="Lägg till drag" onClose={ onClose }><Loading /></Modal>;
	}
	if ( ! catalog.available ) {
		return (
			<Modal title="Lägg till drag" onClose={ onClose }>
				<p>Dragkalendern (pluginet Nordiska Bin – Dragkalender) är inte aktiverad på webbplatsen. Aktivera den för att välja drag bland växterna, eller lägg till ett drag för hand med "+ Aktivitet" och typen Drag.</p>
			</Modal>
		);
	}
	const norm = ( s ) => String( s || '' ).toLowerCase();
	const list = catalog.plants.filter( ( pl ) => ! q || norm( pl.name ).includes( norm( q ) ) || norm( pl.latin ).includes( norm( q ) ) );
	const mine = catalog.mine.filter( ( s ) => ! have.has( s ) && ! picked.includes( s ) );
	const toggle = ( slug ) => setPicked( ( p ) => ( p.includes( slug ) ? p.filter( ( x ) => x !== slug ) : [ ...p, slug ] ) );
	const save = async () => {
		setBusy( true );
		try {
			for ( const slug of picked ) {
				const pl = catalog.plants.find( ( x ) => x.slug === slug );
				await saveRecord( 'plan', { kind: 'drag', name: pl.name, note: pl.latin, week_start: pl.week_start || 1, week_end: pl.week_end || pl.week_start || 1, source: 'nbd:' + slug, scope: form.scope } );
			}
			toast( `${ picked.length } drag lades till i driftplanen.` );
			onSaved();
			onClose();
		} catch ( e ) {
			toast( e.message, 'error' );
		}
		setBusy( false );
	};
	return (
		<Modal wide title="Lägg till drag vid bigårdarna" onClose={ onClose } footer={ <><Button variant="ghost" onClick={ onClose }>Avbryt</Button><Button onClick={ save } disabled={ busy || ! picked.length }>{ busy ? 'Sparar…' : `Lägg till ${ picked.length || '' } drag` }</Button></> }>
			<p className="nbs-muted">Välj växterna som finns vid dina bigårdar. Uppgifterna kommer från dragkalendern ({ catalog.plants.length } växter).</p>
			<div className="nbs-toolbar">
				<input type="search" value={ q } onChange={ ( e ) => setQ( e.target.value ) } placeholder="Sök växt, t.ex. sälg, klöver, lind" aria-label="Sök växt" />
				{ mine.length > 0 && <button type="button" className="nbs-link-btn" onClick={ () => setPicked( ( p ) => [ ...p, ...mine ] ) }>Välj från Min dragkalender ({ mine.length })</button> }
			</div>
			<ul className="nbs-drag-pick">
				{ list.slice( 0, 80 ).map( ( pl ) => (
					<li key={ pl.slug } className={ have.has( pl.slug ) ? 'is-have' : '' }>
						<label>
							<input type="checkbox" disabled={ have.has( pl.slug ) } checked={ have.has( pl.slug ) || picked.includes( pl.slug ) } onChange={ () => toggle( pl.slug ) } />
							<span className="nbs-drag-dot" style={ { background: pl.color || '#4A8A5A' } } />
							<strong>{ pl.name }</strong>
							<span className="nbs-muted">{ pl.latin } · v. { pl.week_start }–{ pl.week_end }{ pl.nectar ? ` · nektar ${ LEVEL[ pl.nectar ] }` : '' }{ pl.pollen ? ` · pollen ${ LEVEL[ pl.pollen ] }` : '' }{ have.has( pl.slug ) ? ' · finns redan' : '' }</span>
						</label>
					</li>
				) ) }
				{ list.length > 80 && <li className="nbs-muted">{ list.length - 80 } till – sök för att hitta fler.</li> }
				{ ! list.length && <li className="nbs-muted">Ingen växt matchar.</li> }
			</ul>
			{ picked.length > 0 && <p><strong>Valda:</strong> { picked.map( ( s ) => ( catalog.plants.find( ( x ) => x.slug === s ) || { name: s } ).name ).join( ', ' ) }</p> }
			<ScopeField form={ form } set={ ( k, v ) => setForm( ( f ) => ( { ...f, [ k ]: v } ) ) } />
		</Modal>
	);
}
