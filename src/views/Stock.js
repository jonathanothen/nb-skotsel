import { useState, useMemo } from '@wordpress/element';
import { api } from '../api';
import { href } from '../router';
import { useMe } from '../App';
import { useRegister, today } from '../register';
import { useLoad, Loading, ErrorBox, Button, Empty } from '../ui';
import { useStock, StockModal, CountModal, TxTable, locName, fmtQty, fmtKr, unit, num, TX_TYPES } from '../stock';

export default function Stock( { route } ) {
	const reg = useRegister();
	const [ stock, error, reload ] = useStock();
	if ( reg.error || error ) {
		return <div className="nbs-page"><ErrorBox error={ reg.error || error } /></div>;
	}
	if ( reg.loading || ! stock ) {
		return <Loading />;
	}
	const [ sub, id ] = route;
	return <StockPage stock={ stock } reload={ reload } sub={ sub || 'saldo' } id={ id } />;
}

function StockPage( { stock, reload, sub, id } ) {
	const me = useMe();
	const [ dialog, setDialog ] = useState( null );
	const [ stamp, setStamp ] = useState( 0 );
	const refresh = () => {
		reload();
		setStamp( ( s ) => s + 1 );
	};
	const value = stock.items.reduce( ( s, i ) => s + stock.sum( i.id ) * stock.price( i.id ), 0 );
	const low = stock.items.filter( ( i ) => i.active && i.data.min_saldo !== undefined && stock.sum( i.id, [ 'store' ] ) < num( i.data.min_saldo ) );
	const item = sub === 'artikel' ? stock.item[ id ] : null;

	const head = (
		<header className="nbs-page-head">
			<div>
				<h1 className="nbs-h1">Lager</h1>
				<p className="nbs-muted">{ stock.items.filter( ( i ) => i.active ).length } artiklar · lagervärde { fmtKr( value ) }{ low.length > 0 && <> · <span className="nbs-warn-inline">{ low.length } under minsta saldo</span></> }</p>
			</div>
			{ me.can.write && (
				<div className="nbs-row-actions">
					<Button variant="ghost" onClick={ () => setDialog( { count: true } ) }>Inventera</Button>
					<Button variant="ghost" onClick={ () => setDialog( { mode: 'move', preset: item ? { item_id: item.id } : {} } ) }>Uttag / flytt</Button>
					<Button variant="ghost" onClick={ () => setDialog( { mode: 'distribute', preset: item ? { item_id: item.id } : {} } ) }>Fördela</Button>
					<Button onClick={ () => setDialog( { mode: 'purchase', preset: item ? { item_id: item.id } : {} } ) }>+ Inköp</Button>
				</div>
			) }
		</header>
	);

	const tabs = (
		<nav className="nbs-subtabs" aria-label="Lager">
			<a href={ href( 'lager' ) } className={ sub === 'saldo' ? 'is-active' : '' }>Saldo</a>
			<a href={ href( 'lager/rorelser' ) } className={ sub === 'rorelser' ? 'is-active' : '' }>Rörelser</a>
			<a href={ href( 'lager/behov' ) } className={ sub === 'behov' ? 'is-active' : '' }>Behov</a>
			{ stock.item_list && <a href={ href( 'listor/' + stock.item_list.id ) }>Artiklar ↗</a> }
		</nav>
	);

	let body;
	if ( sub === 'artikel' ) {
		body = item ? <ItemDetail stock={ stock } item={ item } stamp={ stamp } onChanged={ refresh } /> : <Empty title="Artikeln finns inte" />;
	} else if ( sub === 'rorelser' ) {
		body = <Movements stock={ stock } stamp={ stamp } onChanged={ refresh } />;
	} else if ( sub === 'behov' ) {
		body = <Needs stock={ stock } />;
	} else {
		body = <Balances stock={ stock } low={ low } />;
	}

	return (
		<div className="nbs-page">
			{ sub === 'artikel' && <a className="nbs-back" href={ href( 'lager' ) }>← Lagret</a> }
			{ head }
			{ sub !== 'artikel' && tabs }
			{ body }
			{ dialog && dialog.count && <CountModal stock={ stock } onClose={ () => setDialog( null ) } onDone={ refresh } /> }
			{ dialog && ! dialog.count && <StockModal stock={ stock } mode={ dialog.mode } preset={ dialog.preset } onClose={ () => setDialog( null ) } onDone={ refresh } /> }
		</div>
	);
}

/* ------------------------------------------------------------------ Saldo */

function Balances( { stock, low } ) {
	const [ q, setQ ] = useState( '' );
	const [ cat, setCat ] = useState( '' );
	const [ onlyStock, setOnlyStock ] = useState( false );
	const cats = [ ...new Set( stock.items.map( ( i ) => i.data.kategori ).filter( Boolean ) ) ];
	const s = q.trim().toLowerCase();
	const rows = stock.items.filter( ( i ) => i.active && ( ! cat || i.data.kategori === cat ) && ( ! s || i.name.toLowerCase().includes( s ) ) && ( ! onlyStock || stock.sum( i.id ) > 0 ) );

	if ( ! stock.items.length ) {
		return (
			<Empty title="Inga artiklar ännu">
				<p>Artiklarna är posterna i listan Material och artiklar – lägg in dem där (eller hämta startpaketet på översikten). Gör sedan en inventering så att lagret får sina första saldon.</p>
				{ stock.item_list && <a className="nbs-btn is-primary" href={ href( 'listor/' + stock.item_list.id ) }>Till artiklarna</a> }
			</Empty>
		);
	}
	return (
		<>
			{ low.length > 0 && (
				<div className="nbs-alert">
					<strong>Under minsta saldo:</strong> { low.map( ( i, n ) => <span key={ i.id }>{ n > 0 && ', ' }<a href={ href( 'lager/artikel/' + i.id ) }>{ i.name }</a> ({ fmtQty( stock.sum( i.id, [ 'store' ] ) ) } av { fmtQty( num( i.data.min_saldo ) ) } { unit( i ) })</span> ) }
				</div>
			) }
			<div className="nbs-toolbar">
				<input type="search" className="nbs-search" placeholder="Sök artikel" value={ q } onChange={ ( e ) => setQ( e.target.value ) } aria-label="Sök artikel" />
				<select value={ cat } onChange={ ( e ) => setCat( e.target.value ) } aria-label="Kategori">
					<option value="">Alla kategorier</option>
					{ cats.map( ( c ) => <option key={ c } value={ c }>{ c }</option> ) }
				</select>
				<label className="nbs-inline-check"><input type="checkbox" checked={ onlyStock } onChange={ ( e ) => setOnlyStock( e.target.checked ) } /> Bara artiklar med saldo</label>
			</div>
			<div className="nbs-table-wrap">
				<table className="nbs-table">
					<thead><tr><th>Artikel</th><th>Kategori</th><th className="is-num">I lager</th><th className="is-num">Ute i bigårdar/kupor</th><th className="is-num">Totalt</th><th className="is-num">Värde</th></tr></thead>
					<tbody>
						{ rows.map( ( i ) => {
							const inStore = stock.sum( i.id, [ 'store' ] );
							const out = stock.sum( i.id, [ 'apiary', 'hive' ] );
							const isLow = low.includes( i );
							return (
								<tr key={ i.id }>
									<td><a href={ href( 'lager/artikel/' + i.id ) }><strong>{ i.name }</strong></a>{ isLow && <span className="nbs-badge is-low">Lågt</span> }</td>
									<td data-label="Kategori">{ i.data.kategori || '–' }</td>
									<td data-label="I lager" className="is-num">{ fmtQty( inStore ) } { unit( i ) }</td>
									<td data-label="Ute" className="is-num">{ out ? `${ fmtQty( out ) } ${ unit( i ) }` : '–' }</td>
									<td data-label="Totalt" className="is-num"><strong>{ fmtQty( inStore + out ) } { unit( i ) }</strong></td>
									<td data-label="Värde" className="is-num">{ stock.price( i.id ) && inStore + out ? fmtKr( ( inStore + out ) * stock.price( i.id ) ) : '–' }</td>
								</tr>
							);
						} ) }
					</tbody>
				</table>
			</div>
		</>
	);
}

/* ------------------------------------------------------------------ Rörelser */

function Movements( { stock, stamp, onChanged } ) {
	const [ type, setType ] = useState( '' );
	const [ itemId, setItemId ] = useState( '' );
	const [ since, setSince ] = useState( '' );
	const qs = new URLSearchParams( { limit: 300, ...( type && { type } ), ...( itemId && { item_id: itemId } ), ...( since && { since } ) } ).toString();
	const [ tx, error, reload ] = useLoad( () => api( 'stock/tx?' + qs ), [ qs, stamp ] );
	return (
		<>
			<div className="nbs-toolbar">
				<select value={ type } onChange={ ( e ) => setType( e.target.value ) } aria-label="Typ">
					<option value="">Alla typer</option>
					{ Object.entries( TX_TYPES ).map( ( [ k, l ] ) => <option key={ k } value={ k }>{ l }</option> ) }
				</select>
				<select value={ itemId } onChange={ ( e ) => setItemId( e.target.value ) } aria-label="Artikel">
					<option value="">Alla artiklar</option>
					{ stock.items.map( ( i ) => <option key={ i.id } value={ i.id }>{ i.name }</option> ) }
				</select>
				<label className="nbs-inline-check">Från <input type="date" value={ since } onChange={ ( e ) => setSince( e.target.value ) } /></label>
			</div>
			<ErrorBox error={ error } />
			{ ! tx && ! error && <Loading /> }
			{ tx && <TxTable tx={ tx } stock={ stock } onChanged={ () => ( reload(), onChanged() ) } /> }
		</>
	);
}

/* ------------------------------------------------------------------ Behov */

function Needs( { stock } ) {
	const reg = useRegister();
	const [ colonies, setColonies ] = useState( String( reg.activeColonies.length ) );
	const n = num( colonies );
	const rows = useMemo(
		() =>
			stock.items
				.filter( ( i ) => i.active && num( i.data.behov_per_samhalle ) > 0 )
				.map( ( i ) => {
					const need = num( i.data.behov_per_samhalle ) * n;
					const have = stock.sum( i.id );
					const buy = Math.max( 0, need - have );
					return { i, need, have, buy, cost: buy * stock.price( i.id ) };
				} ),
		[ stock, n ]
	);
	const cost = rows.reduce( ( s, r ) => s + r.cost, 0 );
	return (
		<>
			<div className="nbs-needs-head">
				<div className="nbs-field">
					<label htmlFor="nbs-need-n">Antal samhällen att räkna på</label>
					<input id="nbs-need-n" type="text" inputMode="numeric" value={ colonies } onChange={ ( e ) => setColonies( e.target.value ) } />
					<small className="nbs-help">Nu { reg.activeColonies.length } aktiva. Driftplanen: 60, 120, 150 och 300 produktionssamhällen år 1, 2, 3 och 5.</small>
				</div>
				{ rows.length > 0 && <p className="nbs-needs-sum">Att köpa: <strong>{ fmtKr( cost ) }</strong></p> }
			</div>
			{ rows.length === 0 ? (
				<Empty title="Inga behov angivna">
					<p>Ange <em>Behov per samhälle</em> på artiklarna i listan Material och artiklar, t.ex. 7 skattlådor eller 15 kg invintringsfoder per samhälle. Då räknas inköpsbehovet fram här.</p>
					{ stock.item_list && <a className="nbs-btn is-primary" href={ href( 'listor/' + stock.item_list.id ) }>Till artiklarna</a> }
				</Empty>
			) : (
				<div className="nbs-table-wrap">
					<table className="nbs-table">
						<thead><tr><th>Artikel</th><th className="is-num">Per samhälle</th><th className="is-num">Behov</th><th className="is-num">Finns</th><th className="is-num">Att köpa</th><th className="is-num">Kostnad</th></tr></thead>
						<tbody>
							{ rows.map( ( { i, need, have, buy, cost: c } ) => (
								<tr key={ i.id }>
									<td><a href={ href( 'lager/artikel/' + i.id ) }>{ i.name }</a></td>
									<td data-label="Per samhälle" className="is-num">{ fmtQty( num( i.data.behov_per_samhalle ) ) } { unit( i ) }</td>
									<td data-label="Behov" className="is-num">{ fmtQty( need ) }</td>
									<td data-label="Finns" className="is-num">{ fmtQty( have ) }</td>
									<td data-label="Att köpa" className="is-num">{ buy > 0 ? <strong>{ fmtQty( Math.ceil( buy * 1000 ) / 1000 ) } { unit( i ) }</strong> : <span className="nbs-ok">Räcker</span> }</td>
									<td data-label="Kostnad" className="is-num">{ c ? fmtKr( c ) : '–' }</td>
								</tr>
							) ) }
						</tbody>
					</table>
				</div>
			) }
		</>
	);
}

/* ------------------------------------------------------------------ En artikel */

function ItemDetail( { stock, item, stamp, onChanged } ) {
	const reg = useRegister();
	const [ tx, error, reload ] = useLoad( () => api( 'stock/tx?item_id=' + item.id ), [ item.id, stamp ] );
	const places = ( stock.bal[ item.id ] || [] ).filter( ( b ) => b.qty > 0.0005 ).sort( ( a, b ) => ( a.type !== 'store' ) - ( b.type !== 'store' ) || b.qty - a.qty );
	const year = today().slice( 0, 4 );
	const used = ( tx || [] ).filter( ( t ) => t.type === 'forbrukning' && t.date.startsWith( year ) ).reduce( ( s, t ) => s + t.qty, 0 );
	return (
		<>
			<h2 className="nbs-h1 nbs-item-title">{ item.name }</h2>
			<div className="nbs-grid">
				<section className="nbs-card">
					<h2 className="nbs-h2">Saldo per plats</h2>
					{ places.length ? (
						<dl className="nbs-dl">
							{ places.map( ( b ) => (
								<div key={ b.type + b.id }><dt>{ b.type === 'hive' ? <a href={ href( 'samhallen/kupor' ) }>{ locName( b, reg, stock ) }</a> : b.type === 'apiary' ? <a href={ href( 'bigardar/' + b.id ) }>{ locName( b, reg, stock ) }</a> : locName( b, reg, stock ) }</dt><dd>{ fmtQty( b.qty ) } { unit( item ) }</dd></div>
							) ) }
							<div><dt><strong>Totalt</strong></dt><dd><strong>{ fmtQty( stock.sum( item.id ) ) } { unit( item ) }</strong></dd></div>
						</dl>
					) : <p className="nbs-muted">Inget i lager.</p> }
				</section>
				<section className="nbs-card">
					<h2 className="nbs-h2">Artikel</h2>
					<dl className="nbs-dl">
						<div><dt>Kategori</dt><dd>{ item.data.kategori || '–' }</dd></div>
						<div><dt>Enhet</dt><dd>{ unit( item ) }</dd></div>
						<div><dt>Pris</dt><dd>{ stock.price( item.id ) ? `${ fmtKr( stock.price( item.id ) ) } / ${ unit( item ) }${ num( item.data.pris ) ? '' : ' (senaste inköp)' }` : '–' }</dd></div>
						<div><dt>Minsta saldo</dt><dd>{ item.data.min_saldo !== undefined ? `${ fmtQty( num( item.data.min_saldo ) ) } ${ unit( item ) }` : '–' }</dd></div>
						<div><dt>Behov per samhälle</dt><dd>{ item.data.behov_per_samhalle !== undefined ? `${ fmtQty( num( item.data.behov_per_samhalle ) ) } ${ unit( item ) }` : '–' }</dd></div>
						<div><dt>Förbrukat { year }</dt><dd>{ fmtQty( used ) } { unit( item ) }</dd></div>
					</dl>
					{ stock.item_list && <a href={ href( 'listor/' + stock.item_list.id ) }>Ändra artikeln i listan</a> }
				</section>
			</div>
			<section className="nbs-card nbs-history">
				<h2 className="nbs-h2">Rörelser</h2>
				<ErrorBox error={ error } />
				{ ! tx && ! error && <Loading /> }
				{ tx && <TxTable tx={ tx } stock={ stock } hide={ [ 'item' ] } onChanged={ () => ( reload(), onChanged() ) } /> }
			</section>
		</>
	);
}
