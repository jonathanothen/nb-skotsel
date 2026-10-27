import { useState, useMemo, createContext, useContext } from '@wordpress/element';
import { api, uuid } from './api';
import { href } from './router';
import { useLoad, ErrorBox, Button, Modal, useToast } from './ui';
import { useMe } from './App';
import { useRegister, today, fmtDate } from './register';

/* ------------------------------------------------------------------ Hjälpare */

export const TX_TYPES = { inkop: 'Inköp', flytt: 'Flytt', forbrukning: 'Förbrukning', kassering: 'Kassering', inventering: 'Inventering' };
export const CONSUMABLE = [ 'Foder', 'Behandling', 'Förbrukning' ];

const nf = new Intl.NumberFormat( 'sv-SE', { maximumFractionDigits: 3 } );
const kr = new Intl.NumberFormat( 'sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 } );
export const fmtQty = ( q ) => nf.format( q || 0 );
export const fmtKr = ( v ) => kr.format( v || 0 );
export const num = ( v ) => {
	const n = parseFloat( String( v ?? '' ).replace( ',', '.' ).replace( /\s/g, '' ) );
	return Number.isFinite( n ) ? n : 0;
};
export const unit = ( item ) => ( item && item.data && item.data.enhet ) || 'st';
export const isConsumable = ( item ) => !! item && CONSUMABLE.includes( item.data && item.data.kategori );

/** Lagret laddat och förberett: artiklar per id, saldon per artikel och plats. */
export function useStock() {
	const [ data, error, reload ] = useLoad( () => api( 'stock' ) );
	const stock = useMemo( () => {
		if ( ! data ) {
			return null;
		}
		const item = Object.fromEntries( data.items.map( ( i ) => [ i.id, i ] ) );
		const store = Object.fromEntries( data.stores.map( ( s ) => [ s.id, s ] ) );
		const bal = {};
		data.balances.forEach( ( b ) => {
			( bal[ b.item_id ] = bal[ b.item_id ] || [] ).push( b );
		} );
		const at = ( itemId, loc ) => ( ( bal[ itemId ] || [] ).find( ( b ) => b.type === loc.type && b.id === loc.id ) || { qty: 0 } ).qty;
		const sum = ( itemId, types ) => ( bal[ itemId ] || [] ).filter( ( b ) => ! types || types.includes( b.type ) ).reduce( ( s, b ) => s + b.qty, 0 );
		const inLoc = ( loc ) => data.balances.filter( ( b ) => b.type === loc.type && b.id === loc.id && b.qty > 0.0005 );
		// Pris: artikelns eget pris, annars senaste inköpspriset.
		const price = ( itemId ) => num( item[ itemId ] && item[ itemId ].data.pris ) || ( data.last_price && data.last_price[ itemId ] ) || 0;
		return { ...data, item, store, bal, at, sum, inLoc, price };
	}, [ data ] );
	return [ stock, error, reload ];
}

/** "Centrallager", "Gäddviken", "Kupa 14 · samhälle 14" */
export function locName( loc, reg, stock ) {
	if ( ! loc ) {
		return '';
	}
	if ( loc.type === 'store' ) {
		return stock.store[ loc.id ] ? stock.store[ loc.id ].name : 'Lager (borttaget)';
	}
	if ( loc.type === 'apiary' ) {
		return reg.apiary[ loc.id ] ? reg.apiary[ loc.id ].name : 'Bigård (borttagen)';
	}
	const h = reg.hive[ loc.id ];
	if ( ! h ) {
		return 'Kupa (borttagen)';
	}
	const c = reg.activeColonies.find( ( x ) => x.hive_id === h.id );
	return `Kupa ${ h.label }${ c ? ` · samhälle ${ c.code }` : '' }`;
}

/* ------------------------------------------------------------------ Väljare */

export function ItemSelect( { stock, value, onChange, id = 'nbs-item' } ) {
	const groups = {};
	stock.items.filter( ( i ) => i.active || i.id === value ).forEach( ( i ) => {
		const k = ( i.data && i.data.kategori ) || 'Övrigt';
		( groups[ k ] = groups[ k ] || [] ).push( i );
	} );
	return (
		<div className="nbs-field">
			<label htmlFor={ id }>Artikel <span className="nbs-req">*</span></label>
			<select id={ id } value={ value || '' } onChange={ ( e ) => onChange( e.target.value ) }>
				<option value="">– Välj artikel –</option>
				{ Object.entries( groups ).map( ( [ g, arr ] ) => (
					<optgroup key={ g } label={ g }>
						{ arr.map( ( i ) => <option key={ i.id } value={ i.id }>{ i.name }</option> ) }
					</optgroup>
				) ) }
			</select>
			{ ! stock.items.length && <small className="nbs-help">Inga artiklar ännu. Lägg in dem i <a href={ href( 'listor/' + ( stock.item_list && stock.item_list.id ) ) }>listan Material och artiklar</a>.</small> }
		</div>
	);
}

/**
 * Väljer plats: typ (lager, bigård, kupa) + vilken. Med from={ artikel-id } visas bara
 * platser där artikeln finns, med saldo.
 */
export function LocPicker( { label, value, onChange, from, types = [ 'store', 'apiary', 'hive' ], id } ) {
	const reg = useRegister();
	const { stock } = useStockCtx();
	const T = { store: 'Lager', apiary: 'Bigård', hive: 'Kupa' };
	const type = ( value && value.type ) || types[ 0 ];
	let opts = [];
	if ( type === 'store' ) {
		opts = stock.stores.filter( ( s ) => s.active ).map( ( s ) => ( { id: s.id, name: s.name } ) );
	} else if ( type === 'apiary' ) {
		opts = reg.apiaries.filter( ( a ) => a.active ).map( ( a ) => ( { id: a.id, name: a.name } ) );
	} else {
		opts = reg.hives
			.filter( ( h ) => h.active )
			.sort( ( a, b ) => a.label.localeCompare( b.label, 'sv', { numeric: true } ) )
			.map( ( h ) => {
				const c = reg.activeColonies.find( ( x ) => x.hive_id === h.id );
				return { id: h.id, name: `Kupa ${ h.label }${ c ? ` · samhälle ${ c.code }${ reg.apiary[ c.apiary_id ] ? ', ' + reg.apiary[ c.apiary_id ].name : '' }` : ' (ledig)' }` };
			} );
	}
	if ( from ) {
		opts = opts
			.map( ( o ) => ( { ...o, qty: stock.at( from, { type, id: o.id } ) } ) )
			.filter( ( o ) => o.qty > 0.0005 || ( value && o.id === value.id ) )
			.map( ( o ) => ( { ...o, name: `${ o.name } (${ fmtQty( o.qty ) } ${ unit( stock.item[ from ] ) })` } ) );
	}
	return (
		<div className="nbs-field">
			<label htmlFor={ id }>{ label }</label>
			<div className="nbs-loc">
				{ types.length > 1 && (
					<select value={ type } onChange={ ( e ) => onChange( { type: e.target.value, id: '' } ) } aria-label={ `${ label }: typ av plats` }>
						{ types.map( ( t ) => <option key={ t } value={ t }>{ T[ t ] }</option> ) }
					</select>
				) }
				<select id={ id } value={ ( value && value.id ) || '' } onChange={ ( e ) => onChange( { type, id: e.target.value } ) }>
					<option value="">– Välj –</option>
					{ opts.map( ( o ) => <option key={ o.id } value={ o.id }>{ o.name }</option> ) }
				</select>
			</div>
			{ from && ! opts.length && <small className="nbs-help">Artikeln finns inte i någon { T[ type ].toLowerCase() }.</small> }
		</div>
	);
}

/* Lagret delas med väljarna via en enkel kontext (sätts av StockModal/CountModal). */
const StockCtx = createContext( null );
const useStockCtx = () => useContext( StockCtx );

/* ------------------------------------------------------------------ Bokningsdialog */

const TABS = [
	[ 'purchase', 'Inköp' ],
	[ 'move', 'Flytta' ],
	[ 'consume', 'Förbruka' ],
	[ 'distribute', 'Fördela på samhällen' ],
];

/**
 * En dialog för alla bokningar. preset: item_id, from, to, colony_id, apiary_id.
 * Flikarna styr vad som bokas; onDone anropas efter lyckad bokning.
 */
export function StockModal( { stock, mode = 'purchase', preset = {}, onClose, onDone } ) {
	const reg = useRegister();
	const toast = useToast();
	const firstStore = stock.stores.find( ( s ) => s.active );
	const storeLoc = firstStore ? { type: 'store', id: firstStore.id } : null;
	const [ tab, setTab ] = useState( mode );
	const [ itemId, setItemId ] = useState( preset.item_id || '' );
	const [ qty, setQty ] = useState( '' );
	const [ price, setPrice ] = useState( '' );
	const [ from, setFrom ] = useState( preset.from || storeLoc );
	const [ to, setTo ] = useState( preset.to || ( mode === 'purchase' ? storeLoc : null ) );
	const [ colonyId, setColonyId ] = useState( preset.colony_id || '' );
	const [ discard, setDiscard ] = useState( false );
	const [ apiaryId, setApiaryId ] = useState( preset.apiary_id || '' );
	const [ picked, setPicked ] = useState( null );
	const [ dmode, setDmode ] = useState( 'each' );
	const [ kind, setKind ] = useState( 'consume' );
	const [ date, setDate ] = useState( today() );
	const [ note, setNote ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ err, setErr ] = useState( null );
	const item = stock.item[ itemId ];
	const u = unit( item );

	const pickItem = ( id ) => {
		setItemId( id );
		const it = stock.item[ id ];
		setPrice( it && it.data && it.data.pris !== undefined ? String( it.data.pris ).replace( '.', ',' ) : '' );
		setKind( isConsumable( it ) ? 'consume' : 'move' );
		if ( tab === 'move' || tab === 'consume' ) {
			// Förslag på varifrån: lagret om artikeln finns där, annars den första plats där den finns.
			const there = ( stock.bal[ id ] || [] ).filter( ( b ) => b.qty > 0.0005 );
			if ( ! from || ! there.some( ( b ) => b.type === from.type && b.id === from.id ) ) {
				const pick = there.find( ( b ) => b.type === 'store' ) || there[ 0 ];
				if ( pick ) {
					setFrom( { type: pick.type, id: pick.id } );
				}
			}
		}
	};

	const colonies = reg.activeColonies.filter( ( c ) => ! apiaryId || c.apiary_id === apiaryId ).sort( ( a, b ) => String( a.code ).localeCompare( String( b.code ), 'sv', { numeric: true } ) );
	const chosen = picked || colonies.map( ( c ) => c.id );
	const n = colonies.filter( ( c ) => chosen.includes( c.id ) ).length;
	const q = num( qty );
	const total = tab === 'distribute' && dmode === 'each' ? q * n : q;
	const available = item && from ? stock.at( item.id, from ) : null;
	// Från en kupa bokas förbrukningen på samhället i kupan.
	const hiveColony = from && from.type === 'hive' ? reg.activeColonies.find( ( c ) => c.hive_id === from.id ) : null;

	const valid = item && q > 0 && ( tab === 'purchase' ? to && to.id : from && from.id ) && ( tab !== 'move' || ( to && to.id ) ) && ( tab !== 'distribute' || n > 0 );

	const run = async () => {
		setBusy( true );
		setErr( null );
		const base = { id: uuid(), item_id: itemId, qty, date, note };
		try {
			let res;
			if ( tab === 'purchase' ) {
				res = await api( 'stock/purchase', { method: 'POST', body: { ...base, to, unit_price: price } } );
			} else if ( tab === 'move' ) {
				res = await api( 'stock/move', { method: 'POST', body: { ...base, from, to } } );
			} else if ( tab === 'consume' ) {
				res = await api( 'stock/consume', { method: 'POST', body: { ...base, from, kind: discard ? 'kassering' : 'forbrukning', colony_id: hiveColony ? hiveColony.id : colonyId || null } } );
			} else {
				res = await api( 'stock/distribute', { method: 'POST', body: { ...base, from, colony_ids: colonies.filter( ( c ) => chosen.includes( c.id ) ).map( ( c ) => c.id ), mode: dmode, kind } } );
			}
			toast( 'Bokat i lagret.' );
			onDone && onDone( res );
			onClose();
		} catch ( e ) {
			setErr( e );
			setBusy( false );
		}
	};

	const toggle = ( id ) => setPicked( ( p ) => {
		const cur = p || colonies.map( ( c ) => c.id );
		return cur.includes( id ) ? cur.filter( ( x ) => x !== id ) : [ ...cur, id ];
	} );

	return (
		<StockCtx.Provider value={ { stock } }>
			<Modal
				wide
				title="Boka i lagret"
				onClose={ onClose }
				footer={
					<>
						<span className="nbs-spacer" />
						<Button variant="ghost" onClick={ onClose }>Avbryt</Button>
						<Button onClick={ run } disabled={ busy || ! valid }>{ busy ? 'Bokar…' : 'Boka' }</Button>
					</>
				}
			>
				<div className="nbs-form">
					<div className="nbs-seg" role="tablist">
						{ TABS.map( ( [ k, l ] ) => (
							<button key={ k } type="button" role="tab" aria-selected={ tab === k } className={ tab === k ? 'is-active' : '' } onClick={ () => {
								setTab( k );
								if ( k === 'purchase' && ! to ) {
									setTo( storeLoc );
								}
								if ( k === 'move' && to && to.type === 'store' && from && from.type === 'store' && to.id === from.id ) {
									setTo( null );
								}
							} }>{ l }</button>
						) ) }
					</div>
					<ErrorBox error={ err } />
					<ItemSelect stock={ stock } value={ itemId } onChange={ pickItem } />

					{ tab === 'purchase' && (
						<>
							<div className="nbs-form-row">
								<QtyField label={ `Mängd (${ u })` } value={ qty } onChange={ setQty } />
								<QtyField label="Pris per enhet (kr)" value={ price } onChange={ setPrice } />
							</div>
							<LocPicker id="nbs-to" label="Till" value={ to } onChange={ setTo } />
							{ q > 0 && num( price ) > 0 && <p className="nbs-muted">Summa { fmtKr( q * num( price ) ) }</p> }
						</>
					) }

					{ tab !== 'purchase' && (
						<>
							<LocPicker id="nbs-from" label="Från" value={ from } onChange={ setFrom } from={ itemId || null } />
							{ item && from && from.id && <p className="nbs-muted nbs-avail">Finns { fmtQty( available ) } { u } här.</p> }
						</>
					) }

					{ tab === 'move' && (
						<>
							<QtyField label={ `Mängd (${ u })` } value={ qty } onChange={ setQty } />
							<LocPicker id="nbs-to" label="Till" value={ to } onChange={ setTo } types={ [ 'hive', 'apiary', 'store' ] } />
						</>
					) }

					{ tab === 'consume' && (
						<>
							<QtyField label={ `Mängd (${ u })` } value={ qty } onChange={ setQty } />
							{ hiveColony ? (
								<p className="nbs-muted">Bokas på samhälle { hiveColony.code }.</p>
							) : (
								<div className="nbs-field">
									<label htmlFor="nbs-cons-colony">Bokas på samhälle</label>
									<select id="nbs-cons-colony" value={ colonyId } onChange={ ( e ) => setColonyId( e.target.value ) }>
										<option value="">Inget särskilt samhälle</option>
										{ reg.activeColonies.slice().sort( ( a, b ) => String( a.code ).localeCompare( String( b.code ), 'sv', { numeric: true } ) ).map( ( c ) => <option key={ c.id } value={ c.id }>{ c.code }{ reg.apiary[ c.apiary_id ] ? ` – ${ reg.apiary[ c.apiary_id ].name }` : '' }</option> ) }
									</select>
								</div>
							) }
							<label className="nbs-inline-check"><input type="checkbox" checked={ discard } onChange={ ( e ) => setDiscard( e.target.checked ) } /> Kassera i stället (trasigt, utgånget) – bokas inte på något samhälle</label>
						</>
					) }

					{ tab === 'distribute' && (
						<>
							<div className="nbs-field">
								<label htmlFor="nbs-dist-apiary">Bigård</label>
								<select id="nbs-dist-apiary" value={ apiaryId } onChange={ ( e ) => ( setApiaryId( e.target.value ), setPicked( null ) ) }>
									<option value="">Alla bigårdar</option>
									{ reg.apiaries.filter( ( a ) => a.active ).map( ( a ) => <option key={ a.id } value={ a.id }>{ a.name } ({ reg.coloniesIn( a.id ).length })</option> ) }
								</select>
							</div>
							<fieldset className="nbs-checklist">
								<legend>Samhällen ({ n } av { colonies.length }) <button type="button" className="nbs-link-btn" onClick={ () => setPicked( n === colonies.length ? [] : null ) }>{ n === colonies.length ? 'Inga' : 'Alla' }</button></legend>
								{ colonies.map( ( c ) => (
									<label key={ c.id } className={ `nbs-check-pill${ chosen.includes( c.id ) ? ' is-on' : '' }` }>
										<input type="checkbox" checked={ chosen.includes( c.id ) } onChange={ () => toggle( c.id ) } />{ c.code }
									</label>
								) ) }
								{ ! colonies.length && <p className="nbs-muted">Inga aktiva samhällen.</p> }
							</fieldset>
							<div className="nbs-form-row">
								<div className="nbs-field">
									<label htmlFor="nbs-dmode">Mängd anges</label>
									<select id="nbs-dmode" value={ dmode } onChange={ ( e ) => setDmode( e.target.value ) }>
										<option value="each">per samhälle</option>
										<option value="total">totalt, fördelas jämnt</option>
									</select>
								</div>
								<QtyField label={ `Mängd (${ u })` } value={ qty } onChange={ setQty } />
							</div>
							<fieldset className="nbs-radios">
								<legend>Vad händer med materialet?</legend>
								<label><input type="radio" checked={ kind === 'consume' } onChange={ () => setKind( 'consume' ) } /> Förbrukas (foder, behandling) och bokas på varje samhälle</label>
								<label><input type="radio" checked={ kind === 'move' } onChange={ () => setKind( 'move' ) } /> Flyttas till varje samhälles kupa (t.ex. skattlådor, ramar)</label>
							</fieldset>
							{ q > 0 && n > 0 && (
								<p className={ available !== null && available + 0.0005 < total ? 'nbs-warn' : 'nbs-muted' }>
									{ n } samhällen × { fmtQty( dmode === 'each' ? q : total / n ) } { u } = { fmtQty( total ) } { u }.
									{ available !== null && ` Finns ${ fmtQty( available ) } ${ u }.` }
								</p>
							) }
						</>
					) }

					<div className="nbs-form-row">
						<div className="nbs-field">
							<label htmlFor="nbs-st-date">Datum</label>
							<input id="nbs-st-date" type="date" value={ date } onChange={ ( e ) => setDate( e.target.value ) } />
						</div>
						<div className="nbs-field">
							<label htmlFor="nbs-st-note">Kommentar</label>
							<input id="nbs-st-note" type="text" value={ note } onChange={ ( e ) => setNote( e.target.value ) } placeholder={ tab === 'purchase' ? 'T.ex. leverantör, fakturanummer' : '' } />
						</div>
					</div>
				</div>
			</Modal>
		</StockCtx.Provider>
	);
}

function QtyField( { label, value, onChange } ) {
	const id = 'nbs-q-' + label.replace( /\W/g, '' );
	return (
		<div className="nbs-field">
			<label htmlFor={ id }>{ label }</label>
			<input id={ id } type="text" inputMode="decimal" value={ value } onChange={ ( e ) => onChange( e.target.value ) } />
		</div>
	);
}

/* ------------------------------------------------------------------ Inventering */

export function CountModal( { stock, preset, onClose, onDone } ) {
	const toast = useToast();
	const firstStore = stock.stores.find( ( s ) => s.active );
	const [ loc, setLoc ] = useState( preset || ( firstStore ? { type: 'store', id: firstStore.id } : null ) );
	const [ counts, setCounts ] = useState( {} );
	const [ q, setQ ] = useState( '' );
	const [ date, setDate ] = useState( today() );
	const [ busy, setBusy ] = useState( false );
	const [ err, setErr ] = useState( null );
	const s = q.trim().toLowerCase();
	const items = stock.items.filter( ( i ) => i.active && ( ! s || i.name.toLowerCase().includes( s ) ) );
	const changed = Object.entries( counts ).filter( ( [ id, v ] ) => v !== '' && loc && Math.abs( num( v ) - stock.at( id, loc ) ) > 0.0005 );

	const run = async () => {
		setBusy( true );
		setErr( null );
		try {
			await api( 'stock/count', { method: 'POST', body: { id: uuid(), loc, date, counts: Object.fromEntries( changed ) } } );
			toast( `${ changed.length } saldon justerades.` );
			onDone && onDone();
			onClose();
		} catch ( e ) {
			setErr( e );
			setBusy( false );
		}
	};

	return (
		<StockCtx.Provider value={ { stock } }>
			<Modal
				wide
				title="Inventera"
				onClose={ onClose }
				footer={
					<>
						<span className="nbs-muted">{ changed.length } ändringar</span>
						<span className="nbs-spacer" />
						<Button variant="ghost" onClick={ onClose }>Avbryt</Button>
						<Button onClick={ run } disabled={ busy || ! changed.length || ! loc || ! loc.id }>{ busy ? 'Sparar…' : 'Spara inventeringen' }</Button>
					</>
				}
			>
				<div className="nbs-form">
					<ErrorBox error={ err } />
					<p className="nbs-muted">Skriv in vad som faktiskt finns. Bara rader du ändrar justeras, och skillnaden sparas som inventering i loggen. Bra att börja med när lagret läggs in första gången.</p>
					<div className="nbs-form-row">
						<LocPicker id="nbs-count-loc" label="Plats" value={ loc } onChange={ ( l ) => ( setLoc( l ), setCounts( {} ) ) } />
						<div className="nbs-field">
							<label htmlFor="nbs-count-date">Datum</label>
							<input id="nbs-count-date" type="date" value={ date } onChange={ ( e ) => setDate( e.target.value ) } />
						</div>
					</div>
					<input type="search" className="nbs-search" placeholder="Sök artikel" value={ q } onChange={ ( e ) => setQ( e.target.value ) } aria-label="Sök artikel" />
					<div className="nbs-table-wrap nbs-count-table">
						<table className="nbs-table">
							<thead><tr><th>Artikel</th><th>Saldo nu</th><th>Räknat</th></tr></thead>
							<tbody>
								{ items.map( ( i ) => {
									const now = loc && loc.id ? stock.at( i.id, loc ) : 0;
									return (
										<tr key={ i.id }>
											<td>{ i.name }</td>
											<td data-label="Saldo nu">{ fmtQty( now ) } { unit( i ) }</td>
											<td data-label="Räknat">
												<input type="text" inputMode="decimal" className="nbs-count-input" value={ counts[ i.id ] ?? '' } placeholder={ fmtQty( now ) } onChange={ ( e ) => setCounts( ( c ) => ( { ...c, [ i.id ]: e.target.value } ) ) } aria-label={ `Räknat antal ${ i.name }` } />
											</td>
										</tr>
									);
								} ) }
							</tbody>
						</table>
					</div>
					{ ! stock.items.length && <p className="nbs-muted">Inga artiklar. Lägg in dem i listan Material och artiklar först.</p> }
				</div>
			</Modal>
		</StockCtx.Provider>
	);
}

/* ------------------------------------------------------------------ Rörelser */

export function TxTable( { tx, stock, onChanged, hide = [] } ) {
	const reg = useRegister();
	const me = useMe();
	const toast = useToast();
	const undo = async ( t ) => {
		const rows = tx.filter( ( x ) => x.batch_id === t.batch_id ).length;
		if ( ! window.confirm( rows > 1 ? `Ångra hela bokningen (${ rows } rader)? Saldona återställs.` : 'Ångra bokningen? Saldot återställs.' ) ) {
			return;
		}
		try {
			await api( 'stock/batch/' + t.batch_id, { method: 'DELETE' } );
			toast( 'Bokningen ångrades.' );
			onChanged && onChanged();
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	if ( ! tx.length ) {
		return <p className="nbs-muted">Inga rörelser.</p>;
	}
	const seen = new Set();
	return (
		<div className="nbs-table-wrap">
			<table className="nbs-table nbs-tx">
				<thead>
					<tr>
						<th>Datum</th><th>Typ</th>{ ! hide.includes( 'item' ) && <th>Artikel</th> }<th className="is-num">Mängd</th><th>Från → till</th>{ ! hide.includes( 'colony' ) && <th>Samhälle</th> }<th className="is-num">Värde</th><th></th>
					</tr>
				</thead>
				<tbody>
					{ tx.map( ( t ) => {
						const it = stock.item[ t.item_id ];
						const first = ! seen.has( t.batch_id );
						seen.add( t.batch_id );
						const c = reg.colony[ t.colony_id ];
						return (
							<tr key={ t.id }>
								<td>{ fmtDate( t.date ) }</td>
								<td data-label="Typ"><span className={ `nbs-txtype is-${ t.type }` }>{ TX_TYPES[ t.type ] }</span></td>
								{ ! hide.includes( 'item' ) && <td data-label="Artikel">{ it ? <a href={ href( 'lager/artikel/' + it.id ) }>{ it.name }</a> : '(borttagen)' }</td> }
								<td data-label="Mängd" className="is-num">{ fmtQty( t.qty ) } { unit( it ) }</td>
								<td data-label="Från → till">{ t.from ? locName( t.from, reg, stock ) : '' }{ t.from && t.to ? ' → ' : '' }{ t.to ? locName( t.to, reg, stock ) : '' }{ t.note && <div className="nbs-muted nbs-tx-note">{ t.note }</div> }</td>
								{ ! hide.includes( 'colony' ) && <td data-label="Samhälle">{ c ? <a href={ href( 'samhallen/' + c.id ) }>{ c.code }</a> : '' }</td> }
								<td data-label="Värde" className="is-num">{ t.unit_price ? fmtKr( t.qty * t.unit_price ) : '' }</td>
								<td className="nbs-col-order">{ me.can.write && first && <button type="button" className="nbs-link-btn" onClick={ () => undo( t ) }>Ångra</button> }</td>
							</tr>
						);
					} ) }
				</tbody>
			</table>
		</div>
	);
}

/** Lista "2 × Låda 9 ramar, 1 × Botten" för det som finns på en plats. */
export function Contents( { stock, loc, empty = 'Inget material registrerat.' } ) {
	const rows = stock.inLoc( loc );
	if ( ! rows.length ) {
		return <p className="nbs-muted">{ empty }</p>;
	}
	return (
		<ul className="nbs-contents">
			{ rows.map( ( b ) => {
				const it = stock.item[ b.item_id ];
				return <li key={ b.item_id }><strong>{ fmtQty( b.qty ) } { unit( it ) }</strong> <a href={ href( 'lager/artikel/' + b.item_id ) }>{ it ? it.name : '(borttagen)' }</a></li>;
			} ) }
		</ul>
	);
}

/** Förbrukning och kostnad per artikel för en uppsättning rörelser. */
export function consumption( tx ) {
	const by = {};
	let cost = 0;
	tx.filter( ( t ) => t.type === 'forbrukning' ).forEach( ( t ) => {
		by[ t.item_id ] = by[ t.item_id ] || { qty: 0, cost: 0 };
		by[ t.item_id ].qty += t.qty;
		by[ t.item_id ].cost += t.unit_price ? t.qty * t.unit_price : 0;
		cost += t.unit_price ? t.qty * t.unit_price : 0;
	} );
	return { by, cost };
}
