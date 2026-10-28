import { useState, useEffect } from '@wordpress/element';
import { api, uuid, config } from '../api';
import qrcode from 'qrcode-generator';
import { href, go } from '../router';
import { useMe } from '../App';
import { useRegister, COLONY_ACTIVE, COLONY_STATUS, QUEEN_STATUS, QUEEN_ACTIVE, MATING, label, today, fmtDate } from '../register';
import { useLoad, Loading, ErrorBox, Button, Modal, Empty, useToast } from '../ui';
import { useStock, StockModal, TxTable, Contents, consumption, fmtQty, fmtKr, unit } from '../stock';
import { ColonyHealth } from './Health';
import { FieldInput } from '../fields';
import { EntityForm, FieldsModal, History, QueenBadge, StatusBadge, CustomValues, DateNote } from '../reg-ui';

export default function Colonies( { id } ) {
	const reg = useRegister();
	if ( reg.error ) {
		return <div className="nbs-page"><ErrorBox error={ reg.error } /></div>;
	}
	if ( reg.loading ) {
		return <Loading />;
	}
	if ( id === 'kupor' ) {
		return <Hives />;
	}
	return id ? <ColonyDetail key={ id } id={ id } /> : <ColonyList />;
}

function Tabs( { current } ) {
	return (
		<nav className="nbs-subtabs" aria-label="Samhällen och kupor">
			<a href={ href( 'samhallen' ) } className={ current === 'samhallen' ? 'is-active' : '' }>Samhällen</a>
			<a href={ href( 'samhallen/kupor' ) } className={ current === 'kupor' ? 'is-active' : '' }>Kupor</a>
		</nav>
	);
}

/** Naturlig sortering av koder: 2 före 10. */
const byCode = ( a, b ) => String( a.code ).localeCompare( String( b.code ), 'sv', { numeric: true } );

/* ------------------------------------------------------------------ Lista */

function ColonyList() {
	const reg = useRegister();
	const me = useMe();
	const [ q, setQ ] = useState( '' );
	const [ apiary, setApiary ] = useState( '' );
	const [ status, setStatus ] = useState( 'aktiva' );
	const [ editing, setEditing ] = useState( null );
	const [ fieldsOpen, setFieldsOpen ] = useState( false );
	const [ importing, setImporting ] = useState( false );

	const s = q.trim().toLowerCase();
	const list = reg.colonies
		.filter( ( c ) => {
			if ( status === 'aktiva' && ! COLONY_ACTIVE.includes( c.status ) ) {
				return false;
			}
			if ( status === 'avslutade' && COLONY_ACTIVE.includes( c.status ) ) {
				return false;
			}
			if ( ! [ 'aktiva', 'avslutade', 'alla' ].includes( status ) && c.status !== status ) {
				return false;
			}
			if ( apiary && ( apiary === '-' ? c.apiary_id : c.apiary_id !== apiary ) ) {
				return false;
			}
			if ( s ) {
				const qn = reg.queen[ c.queen_id ];
				const hv = reg.hive[ c.hive_id ];
				return ( c.code + ' ' + ( qn ? qn.code : '' ) + ' ' + ( hv ? hv.label : '' ) ).toLowerCase().includes( s );
			}
			return true;
		} )
		.sort( byCode );
	const queenless = reg.activeColonies.filter( ( c ) => ! c.queen_id ).length;

	return (
		<div className="nbs-page">
			<header className="nbs-page-head">
				<div>
					<h1 className="nbs-h1">Samhällen</h1>
					<p className="nbs-muted">{ reg.activeColonies.length } aktiva samhällen{ queenless > 0 && ` · ${ queenless } utan registrerad drottning` }</p>
				</div>
				<div className="nbs-row-actions">
					{ me.can.manage && <Button variant="ghost" onClick={ () => setFieldsOpen( true ) }>Egna fält</Button> }
					{ me.can.write && <Button variant="ghost" onClick={ () => setImporting( true ) }>Importera från Excel</Button> }
					{ me.can.write && <Button onClick={ () => setEditing( {} ) }>+ Nytt samhälle</Button> }
				</div>
			</header>
			<Tabs current="samhallen" />

			<div className="nbs-toolbar">
				<input type="search" className="nbs-search" placeholder="Sök samhälle, drottning eller kupa" value={ q } onChange={ ( e ) => setQ( e.target.value ) } aria-label="Sök" />
				<select value={ apiary } onChange={ ( e ) => setApiary( e.target.value ) } aria-label="Bigård">
					<option value="">Alla bigårdar</option>
					{ reg.apiaries.filter( ( a ) => a.active ).map( ( a ) => <option key={ a.id } value={ a.id }>{ a.name }</option> ) }
					<option value="-">Utan bigård</option>
				</select>
				<select value={ status } onChange={ ( e ) => setStatus( e.target.value ) } aria-label="Status">
					<option value="aktiva">Aktiva</option>
					<option value="avslutade">Avslutade</option>
					<option value="alla">Alla</option>
					{ COLONY_STATUS.map( ( [ k, l ] ) => <option key={ k } value={ k }>{ l }</option> ) }
				</select>
			</div>

			{ reg.colonies.length === 0 ? (
				<Empty title="Inga samhällen ännu">
					<p>{ reg.apiaries.length ? 'Lägg till samhällena i dina bigårdar. Drottning och kupa kan du koppla direkt eller senare.' : 'Börja med att lägga in bigårdarna, så kan samhällena placeras i dem.' }</p>
					{ reg.apiaries.length ? me.can.write && <Button onClick={ () => setEditing( {} ) }>+ Nytt samhälle</Button> : <a className="nbs-btn is-primary" href={ href( 'bigardar' ) }>Till bigårdarna</a> }
				</Empty>
			) : list.length === 0 ? (
				<p className="nbs-muted">Inga samhällen matchar filtret.</p>
			) : (
				<div className="nbs-table-wrap">
					<table className="nbs-table">
						<thead><tr><th>Samhälle</th><th>Status</th><th>Bigård</th><th>Kupa</th><th>Drottning</th><th>Styrka</th><th>Bildat</th></tr></thead>
						<tbody>
							{ list.map( ( c ) => (
								<tr key={ c.id } className={ COLONY_ACTIVE.includes( c.status ) ? '' : 'is-inactive' }>
									<td><a href={ href( 'samhallen/' + c.id ) }><strong>{ c.code }</strong></a></td>
									<td data-label="Status"><StatusBadge status={ c.status } /></td>
									<td data-label="Bigård">{ c.apiary_id && reg.apiary[ c.apiary_id ] ? <a href={ href( 'bigardar/' + c.apiary_id ) }>{ reg.apiary[ c.apiary_id ].name }</a> : '–' }</td>
									<td data-label="Kupa">{ c.hive_id && reg.hive[ c.hive_id ] ? reg.hive[ c.hive_id ].label : '–' }</td>
									<td data-label="Drottning"><QueenBadge q={ reg.queen[ c.queen_id ] } /></td>
									<td data-label="Styrka">{ c.strength ?? '–' }</td>
									<td data-label="Bildat">{ fmtDate( c.started ) }</td>
								</tr>
							) ) }
						</tbody>
					</table>
				</div>
			) }
			{ editing && <EntityForm type="colony" item={ editing } preset={ apiary && apiary !== '-' ? { apiary_id: apiary } : {} } onClose={ () => setEditing( null ) } onSaved={ ( c ) => go( 'samhallen/' + c.id ) } /> }
			{ fieldsOpen && <FieldsModal type="colony" onClose={ () => setFieldsOpen( false ) } /> }
			{ importing && <ImportModal onClose={ () => setImporting( false ) } /> }
		</div>
	);
}

/* ------------------------------------------------------------------ Import från Excel */

const IMPORT_COLS = [ 'Samhälle', 'Bigård', 'Kupa', 'Drottning', 'År', 'Styrka', 'Status' ];

/** Tolkar inklistrade rader (tabb från Excel, eller semikolon/komma från CSV). */
function parsePaste( text ) {
	const lines = text.split( /\r?\n/ ).map( ( l ) => l.trim() ).filter( Boolean );
	if ( ! lines.length ) {
		return [];
	}
	const sep = lines[ 0 ].includes( '\t' ) ? '\t' : lines[ 0 ].includes( ';' ) ? ';' : ',';
	const rows = lines.map( ( l ) => l.split( sep ).map( ( c ) => c.trim().replace( /^"|"$/g, '' ) ) );
	// Rubrikrad hoppas över om första cellen inte är ett nummer/kod som ser ut som data.
	if ( /^(samh|nr|kod|nummer)/i.test( rows[ 0 ][ 0 ] ) ) {
		rows.shift();
	}
	return rows.filter( ( r ) => r[ 0 ] );
}

function ImportModal( { onClose } ) {
	const reg = useRegister();
	const toast = useToast();
	const [ text, setText ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ err, setErr ] = useState( null );
	const rows = parsePaste( text );
	const norm = ( s ) => String( s || '' ).trim().toLowerCase();
	const apiaryOf = ( n ) => reg.apiaries.find( ( a ) => norm( a.name ) === norm( n ) || ( a.code && norm( a.code ) === norm( n ) ) );
	const statusOf = ( s ) => ( COLONY_STATUS.find( ( x ) => norm( x[ 1 ] ) === norm( s ) || x[ 0 ] === norm( s ) ) || [ 'produktion' ] )[ 0 ];
	const exists = ( code ) => reg.colonies.some( ( c ) => norm( c.code ) === norm( code ) );
	const preview = rows.map( ( r ) => ( { code: r[ 0 ], apiary: apiaryOf( r[ 1 ] ), apiaryName: r[ 1 ], hive: r[ 2 ], queen: r[ 3 ], year: r[ 4 ], strength: r[ 5 ], status: statusOf( r[ 6 ] ), skip: exists( r[ 0 ] ) } ) );
	const run = async () => {
		setBusy( true );
		setErr( null );
		let n = 0;
		try {
			const hives = Object.fromEntries( reg.hives.map( ( h ) => [ norm( h.label ), h.id ] ) );
			const queens = Object.fromEntries( reg.queens.map( ( q ) => [ norm( q.code ), q.id ] ) );
			for ( const p of preview.filter( ( x ) => ! x.skip ) ) {
				let hive = null;
				if ( p.hive ) {
					hive = hives[ norm( p.hive ) ] || ( await api( 'hives', { method: 'POST', body: { id: uuid(), label: p.hive, active: true } } ) ).id;
					hives[ norm( p.hive ) ] = hive;
				}
				let queen = null;
				if ( p.queen ) {
					queen = queens[ norm( p.queen ) ] || ( await api( 'queens', { method: 'POST', body: { id: uuid(), code: p.queen, year: Number( p.year ) || null, status: 'parad' } } ) ).id;
					queens[ norm( p.queen ) ] = queen;
				}
				await api( 'colonies', { method: 'POST', body: { id: uuid(), code: p.code, apiary_id: p.apiary ? p.apiary.id : null, hive_id: hive, queen_id: queen, strength: Number( p.strength ) || null, status: p.status } } );
				n++;
			}
			await reg.reload();
			toast( `${ n } samhällen importerades.` );
			onClose();
		} catch ( e ) {
			await reg.reload();
			setErr( new Error( `${ n } samhällen importerades innan felet: ${ e.message }` ) );
			setBusy( false );
		}
	};
	const todo = preview.filter( ( p ) => ! p.skip ).length;
	return (
		<Modal wide title="Importera samhällen från Excel" onClose={ onClose } footer={ <><span className="nbs-spacer" /><Button variant="ghost" onClick={ onClose }>Avbryt</Button><Button onClick={ run } disabled={ busy || ! todo }>{ busy ? 'Importerar…' : `Importera ${ todo } samhällen` }</Button></> }>
			<div className="nbs-form">
				<ErrorBox error={ err } />
				<p className="nbs-muted">Markera raderna i Excel och klistra in här. Kolumnordning: <strong>{ IMPORT_COLS.join( ' · ' ) }</strong>. Bara samhälle är obligatoriskt. Kupor och drottningar som saknas skapas; samhällen som redan finns hoppas över.</p>
				<textarea rows={ 6 } value={ text } onChange={ ( e ) => setText( e.target.value ) } placeholder={ '1\tGäddviken\t1\t26-001\t2026\t4\tProduktion\n2\tGäddviken\t2\t\t\t3' } aria-label="Inklistrade rader" className="nbs-paste" />
				{ preview.length > 0 && (
					<div className="nbs-table-wrap">
						<table className="nbs-table">
							<thead><tr><th>Samhälle</th><th>Bigård</th><th>Kupa</th><th>Drottning</th><th>Styrka</th><th>Status</th></tr></thead>
							<tbody>
								{ preview.map( ( p, i ) => (
									<tr key={ i } className={ p.skip ? 'is-inactive' : '' }>
										<td>{ p.code }{ p.skip && <span className="nbs-badge">Finns redan</span> }</td>
										<td data-label="Bigård">{ p.apiary ? p.apiary.name : p.apiaryName ? <span className="nbs-warn-inline">{ p.apiaryName } (finns inte)</span> : '–' }</td>
										<td data-label="Kupa">{ p.hive || '–' }</td>
										<td data-label="Drottning">{ p.queen ? `${ p.queen }${ p.year ? ' (' + p.year + ')' : '' }` : '–' }</td>
										<td data-label="Styrka">{ p.strength || '–' }</td>
										<td data-label="Status">{ label( COLONY_STATUS, p.status ) }</td>
									</tr>
								) ) }
							</tbody>
						</table>
					</div>
				) }
			</div>
		</Modal>
	);
}

/* ------------------------------------------------------------------ Ett samhälle */

function ColonyDetail( { id } ) {
	const reg = useRegister();
	const me = useMe();
	const [ op, setOp ] = useState( null );
	const c = reg.colony[ id ];
	if ( ! c ) {
		return <div className="nbs-page"><a className="nbs-back" href={ href( 'samhallen' ) }>← Alla samhällen</a><Empty title="Samhället finns inte" /></div>;
	}
	const active = COLONY_ACTIVE.includes( c.status );
	const q = reg.queen[ c.queen_id ];
	const ap = reg.apiary[ c.apiary_id ];
	const hv = reg.hive[ c.hive_id ];
	const parent = reg.colony[ c.parent_id ];
	const children = reg.colonies.filter( ( x ) => x.parent_id === id ).sort( byCode );
	const close = () => setOp( null );

	return (
		<div className="nbs-page">
			<a className="nbs-back" href={ href( 'samhallen' ) }>← Alla samhällen</a>
			<header className="nbs-page-head">
				<div>
					<p className="nbs-eyebrow">Samhälle{ ap ? ` · ${ ap.name }` : '' }</p>
					<h1 className="nbs-h1">{ c.code } <StatusBadge status={ c.status } /></h1>
				</div>
				{ me.can.write && <Button variant="ghost" onClick={ () => setOp( 'edit' ) }>Redigera</Button> }
			</header>

			{ me.can.write && active && (
				<div className="nbs-ops" role="group" aria-label="Åtgärder">
					<Button variant="ghost" onClick={ () => setOp( 'move' ) }>Flytta</Button>
					<Button variant="ghost" onClick={ () => setOp( 'queen' ) }>{ q ? 'Byt drottning' : 'Sätt in drottning' }</Button>
					<Button variant="ghost" onClick={ () => setOp( 'hive' ) }>Byt kupa</Button>
					<Button variant="ghost" onClick={ () => setOp( 'split' ) }>Dela / gör avläggare</Button>
					<Button variant="ghost" onClick={ () => setOp( 'merge' ) }>Slå ihop</Button>
					<Button variant="ghost" onClick={ () => setOp( 'close' ) }>Död eller såld</Button>
				</div>
			) }

			<div className="nbs-grid">
				<section className="nbs-card">
					<h2 className="nbs-h2">Uppgifter</h2>
					<dl className="nbs-dl">
						<div><dt>Bigård</dt><dd>{ ap ? <a href={ href( 'bigardar/' + ap.id ) }>{ ap.name }</a> : '–' }</dd></div>
						<div><dt>Kupa</dt><dd>{ hv ? `${ hv.label }${ hv.system_id ? ' · ' + reg.itemName( hv.system_id ) : '' }` : '–' }</dd></div>
						<div><dt>Styrka</dt><dd>{ c.strength ? `${ c.strength } av 5` : '–' }</dd></div>
						<div><dt>Bildat</dt><dd>{ fmtDate( c.started ) || '–' }</dd></div>
						{ c.ended && <div><dt>Avslutat</dt><dd>{ fmtDate( c.ended ) }</dd></div> }
						{ parent && <div><dt>Bildat ur</dt><dd><a href={ href( 'samhallen/' + parent.id ) }>{ parent.code }</a></dd></div> }
						{ children.length > 0 && <div><dt>Avläggare härifrån</dt><dd>{ children.map( ( x, i ) => <span key={ x.id }>{ i > 0 && ', ' }<a href={ href( 'samhallen/' + x.id ) }>{ x.code }</a></span> ) }</dd></div> }
					</dl>
					<CustomValues fields={ reg.fields.colony } data={ c.data } refs={ reg.refs } />
					{ c.notes && <p className="nbs-notes">{ c.notes }</p> }
				</section>
				<section className="nbs-card">
					<h2 className="nbs-h2">Drottning</h2>
					{ q ? (
						<dl className="nbs-dl">
							<div><dt>Drottning</dt><dd><QueenBadge q={ q } /></dd></div>
							<div><dt>Status</dt><dd><StatusBadge status={ q.status } kind="queen" /></dd></div>
							{ q.mark && <div><dt>Märkfärg</dt><dd>{ q.mark.name }{ q.marked ? '' : ' (inte märkt)' }</dd></div> }
							{ q.line_id && <div><dt>Linje</dt><dd>{ reg.itemName( q.line_id ) }</dd></div> }
							<div><dt>Parning</dt><dd>{ label( MATING, q.mating ) }{ q.mating_place ? `, ${ q.mating_place }` : '' }</dd></div>
							{ q.mother_id && reg.queen[ q.mother_id ] && <div><dt>Mor</dt><dd><QueenBadge q={ reg.queen[ q.mother_id ] } /></dd></div> }
							<div><dt>Vingklippt</dt><dd>{ q.clipped ? 'Ja' : 'Nej' }</dd></div>
						</dl>
					) : (
						<p className="nbs-muted">Ingen registrerad drottning. { active && me.can.write && <button type="button" className="nbs-link-btn" onClick={ () => setOp( 'queen' ) }>Sätt in drottning</button> }</p>
					) }
				</section>
			</div>

			<ColonyHealth colonyId={ c.id } />

			<ColonyMaterial c={ c } />

			<History filter={ { colony_id: id } } ctx="colony" stamp={ c.updated_at + c.queen_id + c.apiary_id + c.status } />

			{ op === 'edit' && <EntityForm type="colony" item={ c } onClose={ ( deleted ) => ( close(), deleted && go( 'samhallen' ) ) } /> }
			{ op === 'move' && <MoveModal c={ c } onClose={ close } /> }
			{ op === 'queen' && <QueenModal c={ c } onClose={ close } /> }
			{ op === 'hive' && <HiveModal c={ c } onClose={ close } /> }
			{ op === 'split' && <SplitModal c={ c } onClose={ close } /> }
			{ op === 'merge' && <MergeModal c={ c } onClose={ close } /> }
			{ op === 'close' && <CloseModal c={ c } onClose={ close } /> }
		</div>
	);
}

/* ------------------------------------------------------------------ Material */

/** Det som finns i samhällets kupa, årets förbrukning och kostnad, och bokning härifrån. */
function ColonyMaterial( { c } ) {
	const reg = useRegister();
	const me = useMe();
	const [ stock, , reloadStock ] = useStock();
	const [ tx, , reloadTx ] = useLoad( () => api( 'stock/tx?colony_id=' + c.id ), [ c.id ] );
	const [ dialog, setDialog ] = useState( null );
	if ( ! stock || ! tx ) {
		return null;
	}
	const year = today().slice( 0, 4 );
	const { by, cost } = consumption( tx.filter( ( t ) => t.date.startsWith( year ) ) );
	const hiveLoc = c.hive_id ? { type: 'hive', id: c.hive_id } : null;
	const refresh = () => {
		reloadStock();
		reloadTx();
	};
	const active = COLONY_ACTIVE.includes( c.status );
	return (
		<section className="nbs-card nbs-history">
			<div className="nbs-card-head">
				<h2 className="nbs-h2">Material</h2>
				{ me.can.write && active && (
					<div className="nbs-row-actions">
						{ hiveLoc && <Button small variant="ghost" onClick={ () => setDialog( { mode: 'move', preset: { to: hiveLoc } } ) }>Till kupan</Button> }
						<Button small onClick={ () => setDialog( { mode: 'consume', preset: { colony_id: c.id } } ) }>Förbruka</Button>
					</div>
				) }
			</div>
			<div className="nbs-grid nbs-grid-tight">
				<div>
					<h3 className="nbs-h3">I kupan{ reg.hive[ c.hive_id ] ? ' ' + reg.hive[ c.hive_id ].label : '' }</h3>
					{ hiveLoc ? <Contents stock={ stock } loc={ hiveLoc } empty="Inga delar registrerade i kupan." /> : <p className="nbs-muted">Samhället har ingen kupa kopplad.</p> }
				</div>
				<div>
					<h3 className="nbs-h3">Förbrukat { year }{ cost > 0 && ` · ${ fmtKr( cost ) }` }</h3>
					{ Object.keys( by ).length ? (
						<ul className="nbs-contents">
							{ Object.entries( by ).map( ( [ itemId, v ] ) => (
								<li key={ itemId }><strong>{ fmtQty( v.qty ) } { unit( stock.item[ itemId ] ) }</strong> { stock.item[ itemId ] ? stock.item[ itemId ].name : '(borttagen)' }{ v.cost > 0 && <span className="nbs-muted"> · { fmtKr( v.cost ) }</span> }</li>
							) ) }
						</ul>
					) : <p className="nbs-muted">Ingen förbrukning i år.</p> }
				</div>
			</div>
			{ tx.length > 0 && (
				<details className="nbs-details">
					<summary>Alla rörelser ({ tx.length })</summary>
					<TxTable tx={ tx } stock={ stock } hide={ [ 'colony' ] } onChanged={ refresh } />
				</details>
			) }
			{ dialog && <StockModal stock={ stock } mode={ dialog.mode } preset={ dialog.preset } onClose={ () => setDialog( null ) } onDone={ refresh } /> }
		</section>
	);
}

/* ------------------------------------------------------------------ Åtgärder */

/** Gemensam ram för åtgärdsdialogerna: skickar till colonies/{id}/{path}. */
function OpModal( { c, title, path, body, valid = true, onClose, onDone, children, submit = 'Spara' } ) {
	const reg = useRegister();
	const toast = useToast();
	const [ date, setDate ] = useState( today() );
	const [ note, setNote ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ err, setErr ] = useState( null );
	const run = async () => {
		setBusy( true );
		setErr( null );
		try {
			const res = await api( `colonies/${ c.id }/${ path }`, { method: 'POST', body: { ...body(), date, note } } );
			await reg.reload();
			toast( 'Sparat i historiken.' );
			onClose();
			onDone && onDone( res );
		} catch ( e ) {
			setErr( e );
			setBusy( false );
		}
	};
	return (
		<Modal
			title={ `${ title } – ${ c.code }` }
			onClose={ onClose }
			footer={
				<>
					<span className="nbs-spacer" />
					<Button variant="ghost" onClick={ onClose }>Avbryt</Button>
					<Button onClick={ run } disabled={ busy || ! valid }>{ busy ? 'Sparar…' : submit }</Button>
				</>
			}
		>
			<div className="nbs-form">
				<ErrorBox error={ err } />
				{ children }
				<DateNote date={ date } setDate={ setDate } note={ note } setNote={ setNote } />
			</div>
		</Modal>
	);
}

function apiaryOptions( reg, except ) {
	return reg.apiaries
		.filter( ( a ) => a.active && a.id !== except )
		.map( ( a ) => [ a.id, `${ a.name } (${ reg.coloniesIn( a.id ).length }${ a.capacity ? '/' + a.capacity : '' })` ] );
}

function freeHives( reg, except ) {
	const used = new Set( reg.activeColonies.filter( ( x ) => x.id !== except ).map( ( x ) => x.hive_id ) );
	return reg.hives.filter( ( h ) => h.active && ! used.has( h.id ) ).sort( ( a, b ) => a.label.localeCompare( b.label, 'sv', { numeric: true } ) );
}

function MoveModal( { c, onClose } ) {
	const reg = useRegister();
	const [ to, setTo ] = useState( '' );
	return (
		<OpModal c={ c } title="Flytta" path="move" body={ () => ( { apiary_id: to } ) } valid={ !! to } onClose={ onClose } submit="Flytta">
			<p className="nbs-muted">Står nu i { reg.apiary[ c.apiary_id ] ? reg.apiary[ c.apiary_id ].name : 'ingen bigård' }.</p>
			<FieldInput field={ { key: 'to', label: 'Till bigård', type: 'select', options: apiaryOptions( reg, c.apiary_id ) } } value={ to } onChange={ setTo } />
		</OpModal>
	);
}

function HiveModal( { c, onClose } ) {
	const reg = useRegister();
	const [ to, setTo ] = useState( '' );
	const hives = freeHives( reg, c.id ).filter( ( h ) => h.id !== c.hive_id );
	return (
		<OpModal c={ c } title="Byt kupa" path="hive" body={ () => ( { hive_id: to || null } ) } onClose={ onClose }>
			<p className="nbs-muted">Kupa nu: { c.hive_id && reg.hive[ c.hive_id ] ? reg.hive[ c.hive_id ].label : 'ingen' }. Bara lediga kupor visas.</p>
			<FieldInput field={ { key: 'to', label: 'Ny kupa', type: 'select', options: hives.map( ( h ) => [ h.id, h.label + ( h.system_id ? ` · ${ reg.itemName( h.system_id ) }` : '' ) ] ), help: hives.length ? '' : 'Det finns inga lediga kupor. Lägg till kupor under fliken Kupor.' } } value={ to } onChange={ setTo } />
		</OpModal>
	);
}

/** Fält för en ny drottning (används vid drottningbyte och delning). */
function NewQueenFields( { value, onChange } ) {
	const reg = useRegister();
	useEffect( () => {
		if ( ! value.code ) {
			api( 'next-code/queen' ).then( ( r ) => onChange( ( v ) => ( v.code ? v : { ...v, code: r.code } ) ) ).catch( () => {} );
		}
	}, [] ); // eslint-disable-line react-hooks/exhaustive-deps
	const set = ( k ) => ( v ) => onChange( ( x ) => ( { ...x, [ k ]: v } ) );
	return (
		<div className="nbs-subform">
			<div className="nbs-form-row">
				<FieldInput field={ { key: 'nq_code', label: 'Drottning (id)', type: 'text', required: true } } value={ value.code } onChange={ set( 'code' ) } />
				<FieldInput field={ { key: 'nq_year', label: 'Kläckningsår', type: 'number' } } value={ value.year } onChange={ set( 'year' ) } />
			</div>
			<div className="nbs-form-row">
				<FieldInput field={ { key: 'nq_status', label: 'Status', type: 'select', noEmpty: true, options: QUEEN_STATUS.filter( ( s ) => QUEEN_ACTIVE.includes( s[ 0 ] ) ) } } value={ value.status } onChange={ set( 'status' ) } />
				<FieldInput field={ { key: 'nq_mating', label: 'Parning', type: 'select', noEmpty: true, options: MATING } } value={ value.mating } onChange={ set( 'mating' ) } />
			</div>
			<div className="nbs-form-row">
				<FieldInput field={ { key: 'nq_line', label: 'Linje', type: 'ref', ref: 'linjer' } } value={ value.line_id } onChange={ set( 'line_id' ) } refs={ reg.refs } />
				<FieldInput field={ { key: 'nq_mother', label: 'Mor', type: 'ref', ref: '@queen' } } value={ value.mother_id } onChange={ set( 'mother_id' ) } refs={ reg.refs } />
			</div>
			<div className="nbs-form-row">
				<FieldInput field={ { key: 'nq_marked', label: 'Märkt', type: 'bool' } } value={ value.marked } onChange={ set( 'marked' ) } />
				<FieldInput field={ { key: 'nq_clipped', label: 'Vingklippt', type: 'bool' } } value={ value.clipped } onChange={ set( 'clipped' ) } />
			</div>
		</div>
	);
}

const OLD_STATUS = QUEEN_STATUS.filter( ( s ) => ! QUEEN_ACTIVE.includes( s[ 0 ] ) );

function QueenModal( { c, onClose } ) {
	const reg = useRegister();
	const [ mode, setMode ] = useState( 'new' );
	const [ queenId, setQueenId ] = useState( '' );
	const [ nq, setNq ] = useState( { status: 'parad', mating: '', year: new Date().getFullYear(), marked: false, clipped: false } );
	const [ oldStatus, setOldStatus ] = useState( 'ersatt' );
	// Lediga drottningar först (utan samhälle), sedan de som sitter i andra samhällen.
	const free = reg.queens.filter( ( q ) => QUEEN_ACTIVE.includes( q.status ) && q.id !== c.queen_id ).sort( ( a, b ) => !! a.colony_id - !! b.colony_id || a.code.localeCompare( b.code, 'sv', { numeric: true } ) );
	const options = free.map( ( q ) => [ q.id, `${ q.code }${ q.year ? ' (' + q.year + ')' : '' }${ q.colony_id && reg.colony[ q.colony_id ] ? ' – sitter i ' + reg.colony[ q.colony_id ].code : ' – ledig' }` ] );
	const valid = mode === 'none' || ( mode === 'existing' ? !! queenId : !! ( nq.code && nq.code.trim() ) );
	return (
		<OpModal
			c={ c }
			title={ c.queen_id ? 'Byt drottning' : 'Sätt in drottning' }
			path="queen"
			valid={ valid }
			onClose={ onClose }
			body={ () => ( {
				old_status: oldStatus,
				queen_id: mode === 'existing' ? queenId : null,
				new_queen: mode === 'new' ? nq : null,
			} ) }
		>
			{ c.queen_id && reg.queen[ c.queen_id ] && (
				<div className="nbs-field">
					<label>Nuvarande drottning <QueenBadge q={ reg.queen[ c.queen_id ] } link={ false } /> blir</label>
					<select value={ oldStatus } onChange={ ( e ) => setOldStatus( e.target.value ) }>
						{ OLD_STATUS.map( ( [ k, l ] ) => <option key={ k } value={ k }>{ l }</option> ) }
						<option value="parad">Kvar som reserv (parad, utan samhälle)</option>
					</select>
				</div>
			) }
			<fieldset className="nbs-radios">
				<legend>Ny drottning</legend>
				<label><input type="radio" checked={ mode === 'new' } onChange={ () => setMode( 'new' ) } /> Registrera en ny drottning</label>
				<label><input type="radio" checked={ mode === 'existing' } onChange={ () => setMode( 'existing' ) } disabled={ ! options.length } /> Välj en befintlig drottning{ ! options.length && ' (inga finns)' }</label>
				{ c.queen_id && <label><input type="radio" checked={ mode === 'none' } onChange={ () => setMode( 'none' ) } /> Ingen – samhället blir drottninglöst</label> }
			</fieldset>
			{ mode === 'existing' && <FieldInput field={ { key: 'q', label: 'Drottning', type: 'select', options, help: 'Sitter drottningen i ett annat samhälle flyttas hon hit.' } } value={ queenId } onChange={ setQueenId } /> }
			{ mode === 'new' && <NewQueenFields value={ nq } onChange={ setNq } /> }
		</OpModal>
	);
}

function SplitModal( { c, onClose } ) {
	const reg = useRegister();
	const [ status, setStatus ] = useState( 'avlaggare' );
	const [ code, setCode ] = useState( '' );
	const [ apiary, setApiary ] = useState( c.apiary_id || '' );
	const [ hive, setHive ] = useState( '' );
	const [ queen, setQueen ] = useState( 'none' );
	const [ nq, setNq ] = useState( { status: 'oparad', mating: '', year: new Date().getFullYear(), marked: false, clipped: false } );
	useEffect( () => {
		api( 'next-code/colony' ).then( ( r ) => setCode( ( x ) => x || r.code ) ).catch( () => {} );
	}, [] );
	// Samuel: den gamla drottningen följer med avläggaren.
	const pickStatus = ( v ) => {
		setStatus( v );
		if ( v === 'samuel' && c.queen_id ) {
			setQueen( 'move' );
		}
	};
	return (
		<OpModal
			c={ c }
			title="Dela"
			path="split"
			submit="Skapa avläggare"
			valid={ !! code.trim() && ( queen !== 'new' || !! ( nq.code && nq.code.trim() ) ) }
			onClose={ onClose }
			onDone={ ( res ) => res && res.child && go( 'samhallen/' + res.child.id ) }
			body={ () => ( { status, code, apiary_id: apiary || null, hive_id: hive || null, queen, new_queen: queen === 'new' ? nq : null } ) }
		>
			<div className="nbs-form-row">
				<FieldInput field={ { key: 'sp_code', label: 'Nytt samhälle (nummer)', type: 'text', required: true } } value={ code } onChange={ setCode } />
				<FieldInput field={ { key: 'sp_status', label: 'Typ', type: 'select', noEmpty: true, options: COLONY_STATUS.filter( ( s ) => COLONY_ACTIVE.includes( s[ 0 ] ) ) } } value={ status } onChange={ pickStatus } />
			</div>
			<div className="nbs-form-row">
				<FieldInput field={ { key: 'sp_apiary', label: 'Bigård', type: 'select', options: apiaryOptions( reg ) } } value={ apiary } onChange={ setApiary } />
				<FieldInput field={ { key: 'sp_hive', label: 'Kupa', type: 'select', options: freeHives( reg ).map( ( h ) => [ h.id, h.label ] ) } } value={ hive } onChange={ setHive } />
			</div>
			<fieldset className="nbs-radios">
				<legend>Drottning i det nya samhället</legend>
				<label><input type="radio" checked={ queen === 'none' } onChange={ () => setQueen( 'none' ) } /> Ingen ännu (drar egen drottning eller får en cell)</label>
				{ c.queen_id && <label><input type="radio" checked={ queen === 'move' } onChange={ () => setQueen( 'move' ) } /> Moderns drottning följer med (Samuel) – modersamhället blir drottninglöst</label> }
				<label><input type="radio" checked={ queen === 'new' } onChange={ () => setQueen( 'new' ) } /> Ny drottning</label>
			</fieldset>
			{ queen === 'new' && <NewQueenFields value={ nq } onChange={ setNq } /> }
		</OpModal>
	);
}

function MergeModal( { c, onClose } ) {
	const reg = useRegister();
	const [ into, setInto ] = useState( '' );
	const [ keep, setKeep ] = useState( 'into' );
	const [ other, setOther ] = useState( 'ersatt' );
	// Samhällen i samma bigård först.
	const options = reg.activeColonies
		.filter( ( x ) => x.id !== c.id )
		.sort( ( a, b ) => ( a.apiary_id !== c.apiary_id ) - ( b.apiary_id !== c.apiary_id ) || byCode( a, b ) )
		.map( ( x ) => [ x.id, `${ x.code }${ x.apiary_id && reg.apiary[ x.apiary_id ] ? ' – ' + reg.apiary[ x.apiary_id ].name : '' }` ] );
	const target = reg.colony[ into ];
	const qThis = reg.queen[ c.queen_id ];
	const qInto = target && reg.queen[ target.queen_id ];
	return (
		<OpModal
			c={ c }
			title="Slå ihop"
			path="merge"
			submit="Slå ihop"
			valid={ !! into }
			onClose={ onClose }
			onDone={ () => go( 'samhallen/' + into ) }
			body={ () => ( { into_id: into, keep, other_status: other } ) }
		>
			<p className="nbs-muted">{ c.code } slås ihop med samhället du väljer och upphör. Bina och yngel räknas till det andra samhället.</p>
			<FieldInput field={ { key: 'into', label: 'Slå ihop med', type: 'select', options } } value={ into } onChange={ setInto } />
			{ target && ( qThis || qInto ) && (
				<>
					<fieldset className="nbs-radios">
						<legend>Vilken drottning blir kvar?</legend>
						<label><input type="radio" checked={ keep === 'into' } onChange={ () => setKeep( 'into' ) } /> { target.code }s drottning { qInto ? <QueenBadge q={ qInto } link={ false } /> : '(ingen)' }</label>
						<label><input type="radio" checked={ keep === 'this' } onChange={ () => setKeep( 'this' ) } disabled={ ! qThis } /> { c.code }s drottning { qThis ? <QueenBadge q={ qThis } link={ false } /> : '(ingen)' }</label>
					</fieldset>
					<FieldInput field={ { key: 'other', label: 'Den andra drottningen blir', type: 'select', noEmpty: true, options: [ ...OLD_STATUS, [ 'parad', 'Kvar som reserv' ] ] } } value={ other } onChange={ setOther } />
				</>
			) }
		</OpModal>
	);
}

function CloseModal( { c, onClose } ) {
	const reg = useRegister();
	const [ status, setStatus ] = useState( 'dod' );
	const [ qs, setQs ] = useState( 'dod' );
	return (
		<OpModal c={ c } title="Död eller såld" path="close" submit="Avsluta samhället" body={ () => ( { status, queen_status: c.queen_id ? qs : '' } ) } onClose={ onClose }>
			<fieldset className="nbs-radios">
				<legend>Vad hände?</legend>
				<label><input type="radio" checked={ status === 'dod' } onChange={ () => ( setStatus( 'dod' ), setQs( 'dod' ) ) } /> Samhället dog</label>
				<label><input type="radio" checked={ status === 'sald' } onChange={ () => ( setStatus( 'sald' ), setQs( 'sald' ) ) } /> Samhället såldes</label>
			</fieldset>
			{ c.queen_id && reg.queen[ c.queen_id ] && (
				<FieldInput field={ { key: 'qs', label: 'Drottningen', type: 'select', noEmpty: true, options: OLD_STATUS } } value={ qs } onChange={ setQs } />
			) }
			<p className="nbs-muted">Samhället finns kvar i registret med sin historik, men räknas inte längre som aktivt. Ett felaktigt avslut kan ändras med Redigera → Status.</p>
		</OpModal>
	);
}

/* ------------------------------------------------------------------ Kupor */

function Hives() {
	const reg = useRegister();
	const me = useMe();
	const toast = useToast();
	const [ editing, setEditing ] = useState( null );
	const [ series, setSeries ] = useState( false );
	const [ fieldsOpen, setFieldsOpen ] = useState( false );
	const [ showAll, setShowAll ] = useState( false );
	const [ labels, setLabels ] = useState( false );
	const [ stock ] = useStock();
	// Kupans delar enligt lagret: "2 × Låda 9 ramar, 1 × Botten".
	const parts = ( h ) => ( stock ? stock.inLoc( { type: 'hive', id: h.id } ).map( ( b ) => `${ fmtQty( b.qty ) } × ${ stock.item[ b.item_id ] ? stock.item[ b.item_id ].name : '?' }` ).join( ', ' ) : '' );
	const user = {};
	reg.activeColonies.forEach( ( c ) => c.hive_id && ( user[ c.hive_id ] = c ) );
	const list = reg.hives.filter( ( h ) => showAll || h.active ).sort( ( a, b ) => a.label.localeCompare( b.label, 'sv', { numeric: true } ) );
	const free = reg.hives.filter( ( h ) => h.active && ! user[ h.id ] ).length;
	if ( labels ) {
		return <QrLabels hives={ list.filter( ( h ) => h.active ) } onClose={ () => setLabels( false ) } />;
	}

	return (
		<div className="nbs-page">
			<header className="nbs-page-head">
				<div>
					<h1 className="nbs-h1">Kupor</h1>
					<p className="nbs-muted">{ reg.hives.filter( ( h ) => h.active ).length } kupor i bruk · { free } lediga. Kupornas delar bokas från lagret (Lager → Uttag/flytt till kupa).</p>
				</div>
				<div className="nbs-row-actions">
					{ me.can.manage && <Button variant="ghost" onClick={ () => setFieldsOpen( true ) }>Egna fält</Button> }
					{ reg.hives.length > 0 && <Button variant="ghost" onClick={ () => setLabels( true ) }>QR-etiketter</Button> }
					{ me.can.write && <Button variant="ghost" onClick={ () => setSeries( true ) }>Lägg till en serie</Button> }
					{ me.can.write && <Button onClick={ () => setEditing( {} ) }>+ Ny kupa</Button> }
				</div>
			</header>
			<Tabs current="kupor" />
			{ reg.hives.length === 0 ? (
				<Empty title="Inga kupor ännu">
					<p>Numrera kuporna och registrera dem här, gärna som en serie (t.ex. 1–60). Sedan kopplas varje samhälle till sin kupa.</p>
					{ me.can.write && <Button onClick={ () => setSeries( true ) }>Lägg till en serie</Button> }
				</Empty>
			) : (
				<>
					{ reg.hives.some( ( h ) => ! h.active ) && (
						<label className="nbs-inline-check"><input type="checkbox" checked={ showAll } onChange={ ( e ) => setShowAll( e.target.checked ) } /> Visa kasserade</label>
					) }
					<div className="nbs-table-wrap">
						<table className="nbs-table">
							<thead><tr><th>Kupa</th><th>Kupsystem</th><th>Samhälle</th><th>Bigård</th><th>Delar</th></tr></thead>
							<tbody>
								{ list.map( ( h ) => {
									const c = user[ h.id ];
									return (
										<tr key={ h.id } className={ h.active ? '' : 'is-inactive' }>
											<td><button type="button" className="nbs-link-btn" onClick={ () => setEditing( h ) }><strong>{ h.label }</strong></button>{ ! h.active && <span className="nbs-badge">Kasserad</span> }</td>
											<td data-label="Kupsystem">{ reg.itemName( h.system_id ) || '–' }</td>
											<td data-label="Samhälle">{ c ? <a href={ href( 'samhallen/' + c.id ) }>{ c.code }</a> : <span className="nbs-muted">Ledig</span> }</td>
											<td data-label="Bigård">{ c && reg.apiary[ c.apiary_id ] ? reg.apiary[ c.apiary_id ].name : '–' }</td>
											<td data-label="Delar" className="nbs-parts">{ parts( h ) || <span className="nbs-muted">–</span> }</td>
										</tr>
									);
								} ) }
							</tbody>
						</table>
					</div>
				</>
			) }
			{ editing && <EntityForm type="hive" item={ editing } onClose={ () => setEditing( null ) } /> }
			{ series && <HiveSeries onClose={ () => setSeries( false ) } toast={ toast } /> }
			{ fieldsOpen && <FieldsModal type="hive" onClose={ () => setFieldsOpen( false ) } /> }
		</div>
	);
}

/**
 * QR-etiketter för kuporna (A4, tre i bredd). Koden öppnar #/kupa/<id>, som visar
 * samhället som står i kupan – skanna med mobilkameran i bigården.
 */
function QrLabels( { hives, onClose } ) {
	const base = window.location.origin + ( config.base && config.base !== 'admin' ? config.base.replace( /\/?$/, '/' ) : '/skotsel/' );
	const svg = ( text ) => {
		const qr = qrcode( 0, 'M' );
		qr.addData( text );
		qr.make();
		return qr.createSvgTag( { cellSize: 4, margin: 0, scalable: true } );
	};
	return (
		<div className="nbs-page nbs-print-page">
			<div className="nbs-print-tools">
				<button type="button" className="nbs-link-btn" onClick={ onClose }>← Kupor</button>
				<Button onClick={ () => window.print() }>Skriv ut</Button>
			</div>
			<p className="nbs-muted nbs-print-hide">Skriv ut på etikettark eller vanligt papper och tejpa/laminera. Kameran i mobilen öppnar samhället direkt när du är inloggad.</p>
			<div className="nbs-qr-sheet">
				{ hives.map( ( h ) => (
					<div key={ h.id } className="nbs-qr-label">
						{ /* QR-koden byggs av kupans id, inte av användarinmatning. */ }
						<span className="nbs-qr" dangerouslySetInnerHTML={ { __html: svg( base + '#/kupa/' + h.id ) } } />
						<span className="nbs-qr-text"><strong>Kupa { h.label }</strong><small>{ config.site || '' }</small></span>
					</div>
				) ) }
			</div>
		</div>
	);
}

/** Skapar många kupor på en gång, t.ex. 1–60 eller K-001–K-060. */
function HiveSeries( { onClose, toast } ) {
	const reg = useRegister();
	const [ prefix, setPrefix ] = useState( '' );
	const [ from, setFrom ] = useState( '1' );
	const [ to, setTo ] = useState( '20' );
	const [ pad, setPad ] = useState( false );
	const [ system, setSystem ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ err, setErr ] = useState( null );
	const a = parseInt( from, 10 );
	const b = parseInt( to, 10 );
	const width = pad ? String( b ).length : 0;
	const name = ( n ) => prefix + String( n ).padStart( width, '0' );
	const existing = new Set( reg.hives.map( ( h ) => h.label ) );
	const labels = a > 0 && b >= a && b - a < 500 ? Array.from( { length: b - a + 1 }, ( _, i ) => name( a + i ) ).filter( ( l ) => ! existing.has( l ) ) : [];

	const run = async () => {
		setBusy( true );
		setErr( null );
		try {
			for ( const label of labels ) {
				await api( 'hives', { method: 'POST', body: { id: uuid(), label, system_id: system || null, active: true } } );
			}
			await reg.reload();
			toast( `${ labels.length } kupor lades till.` );
			onClose();
		} catch ( e ) {
			setErr( e );
			setBusy( false );
			reg.reload();
		}
	};
	return (
		<Modal
			title="Lägg till en serie kupor"
			onClose={ onClose }
			footer={
				<>
					<span className="nbs-spacer" />
					<Button variant="ghost" onClick={ onClose }>Avbryt</Button>
					<Button onClick={ run } disabled={ busy || ! labels.length }>{ busy ? 'Lägger till…' : `Lägg till ${ labels.length } kupor` }</Button>
				</>
			}
		>
			<div className="nbs-form">
				<ErrorBox error={ err } />
				<div className="nbs-form-row">
					<FieldInput field={ { key: 'hs_prefix', label: 'Prefix (valfritt)', type: 'text', help: 'T.ex. K-' } } value={ prefix } onChange={ setPrefix } />
					<FieldInput field={ { key: 'hs_from', label: 'Från nummer', type: 'number' } } value={ from } onChange={ setFrom } />
					<FieldInput field={ { key: 'hs_to', label: 'Till nummer', type: 'number' } } value={ to } onChange={ setTo } />
				</div>
				<FieldInput field={ { key: 'hs_pad', label: 'Fyll ut med nollor (001, 002 …)', type: 'bool' } } value={ pad } onChange={ setPad } />
				<FieldInput field={ { key: 'hs_system', label: 'Kupsystem', type: 'ref', ref: 'kupsystem' } } value={ system } onChange={ setSystem } refs={ reg.refs } />
				<p className="nbs-muted">{ labels.length ? `Blir ${ labels[ 0 ] }${ labels.length > 1 ? ' … ' + labels[ labels.length - 1 ] : '' }. Nummer som redan finns hoppas över.` : 'Ange ett giltigt intervall (högst 500 kupor åt gången).' }</p>
			</div>
		</Modal>
	);
}
