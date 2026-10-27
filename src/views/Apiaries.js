import { useState, useMemo } from '@wordpress/element';
import { api } from '../api';
import { href, go } from '../router';
import { useMe } from '../App';
import { useRegister, COLONY_ACTIVE, COLONY_STATUS, label, fmtDate } from '../register';
import { Loading, ErrorBox, Button, Empty, useToast } from '../ui';
import { EntityForm, FieldsModal, History, Fill, QueenBadge, StatusBadge, CustomValues } from '../reg-ui';
import MapView from '../MapView';
import RoutePlanner from './RoutePlanner';
import { googleTo, appleTo } from '../geo';
import { useStock, StockModal, Contents } from '../stock';

/** "8 produktion · 2 avläggare" */
export function statusSummary( colonies ) {
	const n = {};
	colonies.forEach( ( c ) => ( n[ c.status ] = ( n[ c.status ] || 0 ) + 1 ) );
	return COLONY_STATUS.filter( ( s ) => n[ s[ 0 ] ] ).map( ( s ) => `${ n[ s[ 0 ] ] } ${ s[ 1 ].toLowerCase() }` ).join( ' · ' );
}

export default function Apiaries( { id, sub } ) {
	const reg = useRegister();
	if ( reg.error ) {
		return <div className="nbs-page"><ErrorBox error={ reg.error } /></div>;
	}
	if ( reg.loading ) {
		return <Loading />;
	}
	if ( id === 'rutt' ) {
		return <RoutePlanner routeId={ sub } />;
	}
	return id ? <ApiaryDetail key={ id } id={ id } /> : <ApiaryList />;
}

function ApiaryList() {
	const reg = useRegister();
	const me = useMe();
	const toast = useToast();
	const [ q, setQ ] = useState( '' );
	const [ showInactive, setShowInactive ] = useState( false );
	const [ editing, setEditing ] = useState( null );
	const [ fieldsOpen, setFieldsOpen ] = useState( false );
	const [ busy, setBusy ] = useState( false );

	const visible = reg.apiaries.filter( ( a ) => ( showInactive || a.active ) && ( ! q.trim() || ( a.name + ' ' + ( a.code || '' ) ).toLowerCase().includes( q.trim().toLowerCase() ) ) );
	const groups = useMemo( () => {
		const g = {};
		visible.forEach( ( a ) => {
			const k = a.route_id || '';
			( g[ k ] = g[ k ] || [] ).push( a );
		} );
		return Object.entries( g ).sort( ( a, b ) => ( a[ 0 ] === '' ) - ( b[ 0 ] === '' ) || reg.itemName( a[ 0 ] ).localeCompare( reg.itemName( b[ 0 ] ), 'sv' ) );
	}, [ visible ] ); // eslint-disable-line react-hooks/exhaustive-deps

	const active = reg.apiaries.filter( ( a ) => a.active );
	const capacity = active.reduce( ( s, a ) => s + ( a.capacity || 0 ), 0 );
	const inCapacity = active.filter( ( a ) => a.capacity ).reduce( ( s, a ) => s + reg.coloniesIn( a.id ).length, 0 );
	const unplaced = active.filter( ( a ) => a.lat === null ).length;
	const color = ( a ) => reg.itemColor( a.type_id ) || '#D99A2B';

	const importApiaries = async () => {
		setBusy( true );
		try {
			const r = await api( 'starter/apiaries', { method: 'POST' } );
			await reg.reload();
			toast( r.added ? `${ r.added } bigårdar lades till.` : 'Bigårdarna fanns redan.' );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
		setBusy( false );
	};

	return (
		<div className="nbs-page">
			<header className="nbs-page-head">
				<div>
					<h1 className="nbs-h1">Bigårdar</h1>
					<p className="nbs-muted">
						{ active.length } aktiva bigårdar · { reg.activeColonies.length } samhällen
						{ capacity > 0 && ` · fyllnadsgrad ${ Math.round( ( inCapacity / capacity ) * 100 ) } % (${ inCapacity } av ${ capacity } platser)` }
					</p>
				</div>
				<div className="nbs-row-actions">
					{ me.can.manage && <Button variant="ghost" onClick={ () => setFieldsOpen( true ) }>Egna fält</Button> }
					{ reg.apiaries.length > 0 && <a className="nbs-btn is-ghost" href={ href( 'bigardar/rutt' ) }>Planera körning</a> }
					{ me.can.write && <Button onClick={ () => setEditing( {} ) }>+ Ny bigård</Button> }
				</div>
			</header>

			{ reg.apiaries.length === 0 ? (
				<Empty title="Inga bigårdar ännu">
					<p>Lägg till din första bigård, eller hämta de 13 platserna från logistikplanen (anmälda till Länsstyrelsen 2026-10-02) med slingor och typ. Positionen sätter du sedan på kartan.</p>
					<div className="nbs-row-actions">
						{ me.can.manage && <Button onClick={ importApiaries } disabled={ busy }>{ busy ? 'Lägger in…' : 'Hämta bigårdarna från logistikplanen' }</Button> }
						{ me.can.write && <Button variant="ghost" onClick={ () => setEditing( {} ) }>+ Ny bigård</Button> }
					</div>
				</Empty>
			) : (
				<>
					<MapView
						height={ 340 }
						onOpen={ ( id ) => go( 'bigardar/' + id ) }
						points={ active.map( ( a ) => ( { id: a.id, lat: a.lat, lng: a.lng, label: a.name, color: color( a ), sub: `${ reg.coloniesIn( a.id ).length }${ a.capacity ? '/' + a.capacity : '' } samhällen` } ) ) }
					/>
					{ unplaced > 0 && <p className="nbs-muted nbs-map-note">{ unplaced } bigårdar saknar position. Öppna bigården och välj Redigera för att sätta den på kartan.</p> }

					<div className="nbs-toolbar">
						<input type="search" className="nbs-search" placeholder="Sök bigård" value={ q } onChange={ ( e ) => setQ( e.target.value ) } aria-label="Sök bigård" />
						{ reg.apiaries.length > active.length && (
							<label className="nbs-inline-check"><input type="checkbox" checked={ showInactive } onChange={ ( e ) => setShowInactive( e.target.checked ) } /> Visa inaktiva ({ reg.apiaries.length - active.length })</label>
						) }
					</div>

					{ groups.map( ( [ route, list ] ) => (
						<section key={ route || 'none' } className="nbs-group">
							<h2 className="nbs-h3">{ route ? reg.itemName( route ) : 'Utan slinga' } <span className="nbs-count">{ list.length }</span>{ route && <a className="nbs-group-link" href={ href( 'bigardar/rutt/' + route ) }>Planera slingan →</a> }</h2>
							<div className="nbs-cards">
								{ list.map( ( a ) => {
									const cols = reg.coloniesIn( a.id );
									return (
										<a key={ a.id } className={ `nbs-apiary-card${ a.active ? '' : ' is-inactive' }` } href={ href( 'bigardar/' + a.id ) } style={ { '--nbs-accent': color( a ) } }>
											<span className="nbs-apiary-type">{ reg.itemName( a.type_id ) || 'Ingen typ' }</span>
											<strong className="nbs-apiary-name">{ a.name }</strong>
											<Fill n={ cols.length } max={ a.capacity } />
											<span className="nbs-muted nbs-apiary-sum">{ statusSummary( cols ) || 'Inga samhällen' }</span>
											{ a.lat === null && a.active && <span className="nbs-badge">Ingen position</span> }
										</a>
									);
								} ) }
							</div>
						</section>
					) ) }
				</>
			) }
			{ editing && <EntityForm type="apiary" item={ editing } onClose={ () => setEditing( null ) } onSaved={ ( a ) => go( 'bigardar/' + a.id ) } /> }
			{ fieldsOpen && <FieldsModal type="apiary" onClose={ () => setFieldsOpen( false ) } /> }
		</div>
	);
}

function ApiaryDetail( { id } ) {
	const reg = useRegister();
	const me = useMe();
	const [ editing, setEditing ] = useState( false );
	const [ adding, setAdding ] = useState( false );
	const [ showEnded, setShowEnded ] = useState( false );
	const a = reg.apiary[ id ];
	if ( ! a ) {
		return <div className="nbs-page"><a className="nbs-back" href={ href( 'bigardar' ) }>← Alla bigårdar</a><Empty title="Bigården finns inte" /></div>;
	}
	const all = reg.colonies.filter( ( c ) => c.apiary_id === id );
	const active = all.filter( ( c ) => COLONY_ACTIVE.includes( c.status ) );
	const ended = all.filter( ( c ) => ! COLONY_ACTIVE.includes( c.status ) );
	const color = reg.itemColor( a.type_id ) || '#D99A2B';

	const table = ( list ) => (
		<div className="nbs-table-wrap">
			<table className="nbs-table">
				<thead><tr><th>Samhälle</th><th>Status</th><th>Kupa</th><th>Drottning</th><th>Styrka</th></tr></thead>
				<tbody>
					{ list.map( ( c ) => (
						<tr key={ c.id }>
							<td><a href={ href( 'samhallen/' + c.id ) }><strong>{ c.code }</strong></a></td>
							<td data-label="Status"><StatusBadge status={ c.status } /></td>
							<td data-label="Kupa">{ c.hive_id && reg.hive[ c.hive_id ] ? reg.hive[ c.hive_id ].label : '–' }</td>
							<td data-label="Drottning"><QueenBadge q={ reg.queen[ c.queen_id ] } /></td>
							<td data-label="Styrka">{ c.strength ?? '–' }</td>
						</tr>
					) ) }
				</tbody>
			</table>
		</div>
	);

	return (
		<div className="nbs-page">
			<a className="nbs-back" href={ href( 'bigardar' ) }>← Alla bigårdar</a>
			<header className="nbs-page-head">
				<div>
					<p className="nbs-eyebrow"><span className="nbs-swatch" style={ { background: color } } />{ reg.itemName( a.type_id ) || 'Bigård' }{ a.route_id ? ` · ${ reg.itemName( a.route_id ) }` : '' }{ a.active ? '' : ' · inaktiv' }</p>
					<h1 className="nbs-h1">{ a.name }</h1>
				</div>
				<div className="nbs-row-actions">
					{ me.can.write && <Button variant="ghost" onClick={ () => setEditing( true ) }>Redigera</Button> }
					{ me.can.write && <Button onClick={ () => setAdding( true ) }>+ Nytt samhälle här</Button> }
				</div>
			</header>

			<div className="nbs-grid">
				<section className="nbs-card">
					<h2 className="nbs-h2">Uppgifter</h2>
					<dl className="nbs-dl">
						<div><dt>Samhällen</dt><dd><Fill n={ active.length } max={ a.capacity } /></dd></div>
						{ active.length > 0 && <div><dt>Fördelning</dt><dd>{ statusSummary( active ) }</dd></div> }
						{ a.registered && <div><dt>Anmäld till Länsstyrelsen</dt><dd>{ fmtDate( a.registered ) }</dd></div> }
						{ a.code && <div><dt>Kod</dt><dd>{ a.code }</dd></div> }
						{ a.location && <div><dt>Adress/väg</dt><dd>{ a.location }</dd></div> }
						{ a.lat !== null && <div><dt>GPS</dt><dd>{ String( a.lat ).replace( '.', ',' ) }, { String( a.lng ).replace( '.', ',' ) }</dd></div> }
					</dl>
					<CustomValues fields={ reg.fields.apiary } data={ a.data } refs={ reg.refs } />
					{ a.notes && <p className="nbs-notes">{ a.notes }</p> }
					{ a.lat !== null && (
						<div className="nbs-row-actions nbs-nav-btns">
							<a className="nbs-btn is-primary" href={ googleTo( a ) } target="_blank" rel="noopener noreferrer">Vägbeskrivning i Google Maps</a>
							<a className="nbs-btn is-ghost" href={ appleTo( a, a.name ) } target="_blank" rel="noopener noreferrer">Apple Kartor</a>
						</div>
					) }
				</section>
				<section className="nbs-card nbs-card-map">
					{ a.lat !== null ? (
						<MapView height={ 260 } points={ [ { id: a.id, lat: a.lat, lng: a.lng, label: a.name, color } ] } />
					) : (
						<Empty title="Ingen position">
							<p>Välj Redigera och klicka på kartan där bigården står.</p>
						</Empty>
					) }
				</section>
			</div>

			<section className="nbs-card">
				<h2 className="nbs-h2">Samhällen i bigården</h2>
				{ active.length ? table( active ) : <p className="nbs-muted">Inga aktiva samhällen.</p> }
				{ ended.length > 0 && (
					<>
						<button type="button" className="nbs-link-btn" onClick={ () => setShowEnded( ! showEnded ) }>{ showEnded ? 'Dölj' : 'Visa' } avslutade ({ ended.length })</button>
						{ showEnded && table( ended ) }
					</>
				) }
			</section>

			<ApiaryMaterial a={ a } colonies={ active } />

			<History filter={ { apiary_id: id } } ctx="apiary" stamp={ reg.colonies } />

			{ editing && <EntityForm type="apiary" item={ a } onClose={ ( deleted ) => ( setEditing( false ), deleted && go( 'bigardar' ) ) } /> }
			{ adding && <EntityForm type="colony" preset={ { apiary_id: id } } onClose={ () => setAdding( false ) } /> }
		</div>
	);
}

/** Material som står i bigården och fördelning på bigårdens samhällen. */
function ApiaryMaterial( { a, colonies } ) {
	const me = useMe();
	const [ stock, , reload ] = useStock();
	const [ dialog, setDialog ] = useState( null );
	if ( ! stock ) {
		return null;
	}
	return (
		<section className="nbs-card nbs-history">
			<div className="nbs-card-head">
				<h2 className="nbs-h2">Material i bigården</h2>
				{ me.can.write && (
					<div className="nbs-row-actions">
						<Button small variant="ghost" onClick={ () => setDialog( { mode: 'move', preset: { to: { type: 'apiary', id: a.id } } } ) }>Ta hit material</Button>
						{ colonies.length > 0 && <Button small onClick={ () => setDialog( { mode: 'distribute', preset: { apiary_id: a.id } } ) }>Fördela på samhällena</Button> }
					</div>
				) }
			</div>
			<Contents stock={ stock } loc={ { type: 'apiary', id: a.id } } empty="Inget material står i bigården. Material i kuporna visas på varje samhälle." />
			{ dialog && <StockModal stock={ stock } mode={ dialog.mode } preset={ dialog.preset } onClose={ () => setDialog( null ) } onDone={ reload } /> }
		</section>
	);
}

export { label };