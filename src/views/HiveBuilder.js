import { useEffect, useRef, useState } from '@wordpress/element';
import { api } from '../api';
import { useLoad, Loading, ErrorBox, Button, Modal, useToast } from '../ui';
import { useRegister, today } from '../register';
import { useStock, fmtQty } from '../stock';
import { useMe } from '../App';
import { download } from '../xlsx';

const KINDS = { bottom: 'Botten', box: 'Låda', excluder: 'Spärrgaller', roof: 'Tak' };
// Ordning nerifrån och upp när en del läggs till.
const RANK = { bottom: 0, box: 5, excluder: 5, roof: 9 };
const STORE = 'nbs_hivebuilder';
const newKey = () => Date.now().toString( 36 ) + '-' + Math.random().toString( 36 ).slice( 2, 7 );

const load = () => {
	try {
		return JSON.parse( window.localStorage.getItem( STORE ) ) || null;
	} catch ( e ) {
		return null;
	}
};

/**
 * Kupbyggaren: delar från det gemensamma kupbiblioteket dras in i kupan (eller läggs till med
 * en knapp på mobilen), med antal per del och antal ramar per låda. 3D-vyn laddas separat.
 */
export default function HiveBuilder() {
	const me = useMe();
	const toast = useToast();
	const [ lib, error, reload ] = useLoad( () => api( 'library' ) );
	const saved = load();
	const [ system, setSystem ] = useState( ( saved && saved.system ) || '' );
	const [ stack, setStack ] = useState( ( saved && saved.stack ) || [] );
	const [ hives, setHives ] = useState( ( saved && saved.hives ) || 1 );
	const [ typeId, setTypeId ] = useState( ( saved && saved.typeId ) || '' );
	const [ naming, setNaming ] = useState( null );
	const [ applying, setApplying ] = useState( false );
	const reg = useRegister();
	const types = reg.hivetypes || [];
	const type = types.find( ( t ) => t.id === typeId );
	const [ transparent, setTransparent ] = useState( false );
	const [ exploded, setExploded ] = useState( false );
	const [ selected, setSelected ] = useState( null );
	const [ over, setOver ] = useState( false );
	const [ view3d, setView3d ] = useState( null );
	const [ err3d, setErr3d ] = useState( null );
	const holder = useRef( null );

	const systems = lib ? lib.systems : [];
	const sys = systems.find( ( s ) => s.id === system ) || systems[ 0 ];
	const parts = lib && sys ? lib.parts.filter( ( p ) => p.system === sys.id ) : [];
	const kits = lib && sys ? ( lib.kits || [] ).filter( ( k ) => k.system === sys.id ) : [];
	const partById = ( id ) => lib && lib.parts.find( ( p ) => p.id === id );
	const rows = stack.map( ( s ) => ( { ...s, part: partById( s.part ) } ) ).filter( ( s ) => s.part );
	const frameName = ( id ) => ( ( lib && lib.frames.find( ( f ) => f.id === id ) ) || { name: id } ).name;

	useEffect( () => {
		try {
			window.localStorage.setItem( STORE, JSON.stringify( { system, stack, hives, typeId } ) );
		} catch ( e ) {}
	}, [ system, stack, hives, typeId ] );

	// 3D-vyn skapas en gång när biblioteket finns.
	useEffect( () => {
		if ( ! lib || ! holder.current ) {
			return;
		}
		let view = null;
		let gone = false;
		import( /* webpackChunkName: "hive3d" */ '../hive3d' ).then( ( m ) => {
			if ( gone ) {
				return;
			}
			try {
				view = m.createHiveScene( holder.current, { onPick: setSelected } );
				setView3d( view );
			} catch ( e ) {
				setErr3d( 'Den här enheten kan inte visa 3D (WebGL saknas).' );
			}
		} ).catch( () => setErr3d( '3D-vyn kunde inte laddas.' ) );
		return () => {
			gone = true;
			if ( view ) {
				view.dispose();
			}
		};
	}, [ !! lib ] );

	useEffect( () => {
		if ( view3d ) {
			view3d.setStack( rows.map( ( r ) => ( { part: r.part, qty: r.qty, frames: r.frames } ) ), lib, { transparent, exploded, selected } );
		}
	}, [ view3d, JSON.stringify( stack ), transparent, exploded, selected ] );

	const add = ( id ) => {
		const p = partById( id );
		if ( ! p ) {
			return;
		}
		setStack( ( st ) => {
			const rank = RANK[ p.kind ] ?? 5;
			let at = st.length;
			while ( at > 0 && ( RANK[ ( partById( st[ at - 1 ].part ) || {} ).kind ] ?? 5 ) > rank ) {
				at--;
			}
			// Samma låda direkt under räknas upp; med t.ex. ett spärrgaller emellan blir det en ny rad.
			if ( p.kind === 'box' && at > 0 && st[ at - 1 ].part === id ) {
				return st.map( ( s, i ) => ( i === at - 1 ? { ...s, qty: s.qty + 1 } : s ) );
			}
			return [ ...st.slice( 0, at ), { key: newKey(), part: id, qty: 1, frames: p.kind === 'box' ? p.frames || 0 : 0 }, ...st.slice( at ) ];
		} );
	};
	// Delar en rad med flera lådor: en låda läggs som egen rad ovanpå, så att något kan läggas emellan.
	const split = ( i ) => setStack( ( st ) => {
		const s = st[ i ];
		if ( ! s || s.qty < 2 ) {
			return st;
		}
		return [ ...st.slice( 0, i ), { ...s, qty: s.qty - 1 }, { ...s, key: newKey(), qty: 1 }, ...st.slice( i + 1 ) ];
	} );
	const update = ( i, patch ) => setStack( ( st ) => st.map( ( s, j ) => ( j === i ? { ...s, ...patch } : s ) ) );
	const remove = ( i ) => ( setStack( ( st ) => st.filter( ( s, j ) => j !== i ) ), setSelected( null ) );
	const move = ( i, d ) => setStack( ( st ) => {
		const j = i + d;
		if ( j < 0 || j >= st.length ) {
			return st;
		}
		const n = [ ...st ];
		[ n[ i ], n[ j ] ] = [ n[ j ], n[ i ] ];
		return n;
	} );

	const warnings = [];
	if ( rows.length ) {
		const feet = [ ...new Set( rows.filter( ( r ) => r.part.kind !== 'roof' ).map( ( r ) => r.part.outer.join( '×' ) ) ) ];
		if ( feet.length > 1 ) {
			warnings.push( `Delarna har olika yttermått (${ feet.join( ', ' ) } mm) och passar inte ihop.` );
		}
		const bottoms = rows.filter( ( r ) => r.part.kind === 'bottom' );
		if ( bottoms.length && rows[ 0 ].part.kind !== 'bottom' ) {
			warnings.push( 'Botten ligger inte längst ner.' );
		}
		if ( bottoms.reduce( ( s, r ) => s + r.qty, 0 ) > 1 ) {
			warnings.push( 'Kupan har mer än en botten.' );
		}
		const roofs = rows.filter( ( r ) => r.part.kind === 'roof' );
		if ( roofs.length && rows[ rows.length - 1 ].part.kind !== 'roof' ) {
			warnings.push( 'Taket ligger inte överst.' );
		}
		rows.forEach( ( r, i ) => {
			if ( r.part.kind === 'excluder' && ! ( rows[ i - 1 ] && rows[ i - 1 ].part.kind === 'box' && rows[ i + 1 ] && rows[ i + 1 ].part.kind === 'box' ) ) {
				warnings.push( 'Spärrgallret ska ligga mellan yngelrummet och skattlådan.' );
			}
		} );
		if ( ! roofs.length ) {
			warnings.push( 'Kupan saknar tak.' );
		}
		if ( ! bottoms.length ) {
			warnings.push( 'Kupan saknar botten.' );
		}
	}

	// Materiallista: delar och ramar per kupa och totalt.
	const n = Math.max( 1, parseInt( hives, 10 ) || 1 );
	const bom = {};
	const addBom = ( key, name, qty, price ) => {
		bom[ key ] = bom[ key ] || { name, qty: 0, price };
		bom[ key ].qty += qty;
	};
	rows.forEach( ( r ) => {
		addBom( r.part.id, r.part.name, r.qty, r.part.price );
		if ( r.part.kind === 'box' && r.frames > 0 ) {
			addBom( 'ram-' + r.part.frame, 'Ram ' + frameName( r.part.frame ), r.qty * r.frames );
		}
	} );
	const bomRows = Object.values( bom );
	const height = rows.reduce( ( s, r ) => s + ( r.part.kind === 'roof' ? r.part.top || 20 : r.part.height ) * r.qty, 0 );

	const exportGlb = async () => {
		if ( view3d ) {
			download( await view3d.exportGlb(), 'kupa.glb' );
		}
	};
	const exportPng = () => {
		if ( view3d ) {
			fetch( view3d.snapshot() ).then( ( r ) => r.blob() ).then( ( b ) => download( b, 'kupa.png' ) );
		}
	};
	// Kuptyper: uppbyggnaden sparas och kopplas till listan "Kupsystem och kuptyper".
	const changed = type && JSON.stringify( ( type.config && type.config.stack ) || [] ) !== JSON.stringify( stack.map( ( s ) => ( { part: s.part, qty: s.qty, frames: s.frames } ) ) );
	const openType = ( id ) => {
		const t = types.find( ( x ) => x.id === id );
		setTypeId( id );
		setSelected( null );
		if ( t ) {
			const st = ( t.config && t.config.stack ) || [];
			setStack( st.map( ( s, i ) => ( { ...s, key: t.id + '-' + i } ) ) );
			const first = st.length && partById( st[ 0 ].part );
			if ( first ) {
				setSystem( first.system );
			}
		}
	};
	// Standardkupa ur biblioteket: läggs in som en ny, osparad kupa (spara den som egen kuptyp).
	const openKit = ( id ) => {
		const k = ( lib.kits || [] ).find( ( x ) => x.id === id );
		if ( ! k ) {
			return;
		}
		setTypeId( '' );
		setSelected( null );
		setStack( k.stack.filter( ( s ) => partById( s.part ) ).map( ( s ) => ( { key: newKey(), part: s.part, qty: s.qty || 1, frames: s.frames ?? ( partById( s.part ).frames || 0 ) } ) ) );
	};
	const saveType = async ( name, asNew ) => {
		try {
			const body = { name, stack: stack.map( ( s ) => ( { part: s.part, qty: s.qty, frames: s.frames } ) ) };
			const t = typeId && ! asNew ? await api( 'hivetypes/' + typeId, { method: 'PUT', body } ) : await api( 'hivetypes', { method: 'POST', body } );
			await reg.reload();
			setTypeId( t.id );
			setNaming( null );
			toast( `Kuptypen "${ t.name }" är sparad.` );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};

	const refresh = async () => {
		try {
			await api( 'library?refresh=1' );
			reload();
			toast( 'Biblioteket är uppdaterat.' );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};

	if ( error ) {
		return <div className="nbs-page"><ErrorBox error={ error } /></div>;
	}
	if ( ! lib ) {
		return <div className="nbs-page"><Loading /></div>;
	}
	return (
		<div className="nbs-page nbs-hb">
			<div className="nbs-page-head">
				<div>
					<h1 className="nbs-h1">Kupbyggare</h1>
					<p className="nbs-muted">Dra delar från biblioteket in i kupan, eller tryck på +. Biblioteket är gemensamt för alla som har pluginet{ lib.version ? ` (version ${ lib.version }${ lib.origin === 'github' ? ', från GitHub' : '' })` : '' }.</p>
				</div>
				{ me.can.manage && <Button variant="ghost" small onClick={ refresh }>Hämta nya delar</Button> }
			</div>

			<div className="nbs-hb-typebar nbs-card">
				<label className="nbs-field">
					<span>Kuptyp</span>
					<select value={ typeId } onChange={ ( e ) => ( e.target.value ? openType( e.target.value ) : setTypeId( '' ) ) }>
						<option value="">Ny kupa (inte sparad)</option>
						{ types.map( ( t ) => <option key={ t.id } value={ t.id }>{ t.name }</option> ) }
					</select>
				</label>
				<div className="nbs-row-actions">
					{ me.can.write && type && <Button onClick={ () => saveType( type.name ) } disabled={ ! rows.length || ! changed }>{ changed ? 'Spara ändringar' : 'Sparad' }</Button> }
					{ me.can.write && <Button variant={ type ? 'ghost' : 'primary' } onClick={ () => setNaming( type ? type.name + ' (kopia)' : '' ) } disabled={ ! rows.length }>Spara som kuptyp</Button> }
					{ me.can.write && <Button variant="ghost" onClick={ () => setApplying( true ) } disabled={ ! type || changed }>Lägg ut i bigård / ersätt kupor</Button> }
				</div>
				{ type && changed && <p className="nbs-muted">Spara ändringarna innan kuptypen läggs ut.</p> }
				{ ! type && rows.length > 0 && <p className="nbs-muted">Spara kupan som kuptyp för att kunna lägga ut den i en bigård, ersätta kupor och boka materialet i lagret.</p> }
			</div>

			<div className="nbs-hb-grid">
				<section className="nbs-card nbs-hb-palette">
					<label className="nbs-field">
						<span>System</span>
						<select value={ sys ? sys.id : '' } onChange={ ( e ) => setSystem( e.target.value ) }>
							{ systems.map( ( s ) => <option key={ s.id } value={ s.id }>{ s.name } – { ( lib.brands.find( ( b ) => b.id === s.brand ) || { name: s.brand } ).name }</option> ) }
						</select>
					</label>
					{ kits.length > 0 && (
						<label className="nbs-field">
							<span>Börja från standardkupa</span>
							<select value="" onChange={ ( e ) => e.target.value && openKit( e.target.value ) }>
								<option value="">Välj…</option>
								{ kits.map( ( k ) => <option key={ k.id } value={ k.id }>{ k.name }</option> ) }
							</select>
						</label>
					) }
					<ul className="nbs-hb-parts">
						{ parts.map( ( p ) => (
							<li key={ p.id } draggable onDragStart={ ( e ) => e.dataTransfer.setData( 'text/plain', 'nbs-part:' + p.id ) }>
								<span className={ 'nbs-hb-swatch is-' + p.kind } />
								<span className="nbs-hb-part">
									<strong>{ p.name }</strong>
									<small>{ KINDS[ p.kind ] || p.kind } · { p.outer.join( '×' ) }×{ p.height } mm{ p.frames ? ` · ${ p.frames } ramar` : '' }{ p.source === 'standard' ? ' · standardmått' : '' }</small>
								</span>
								<button type="button" className="nbs-btn is-ghost is-small" onClick={ () => add( p.id ) } aria-label={ 'Lägg till ' + p.name }>+</button>
							</li>
						) ) }
					</ul>
				</section>

				<section
					className={ 'nbs-hb-stage' + ( over ? ' is-over' : '' ) }
					onDragOver={ ( e ) => ( e.preventDefault(), setOver( true ) ) }
					onDragLeave={ () => setOver( false ) }
					onDrop={ ( e ) => {
						e.preventDefault();
						setOver( false );
						const v = e.dataTransfer.getData( 'text/plain' );
						if ( v.startsWith( 'nbs-part:' ) ) {
							add( v.slice( 9 ) );
						}
					} }
				>
					<div ref={ holder } className="nbs-hb-canvas" />
					{ err3d && <p className="nbs-hb-empty">{ err3d }</p> }
					{ ! err3d && ! rows.length && <p className="nbs-hb-empty">Släpp delar här</p> }
					<div className="nbs-hb-tools">
						<label><input type="checkbox" checked={ transparent } onChange={ ( e ) => setTransparent( e.target.checked ) } /> Genomskinlig</label>
						<label><input type="checkbox" checked={ exploded } onChange={ ( e ) => setExploded( e.target.checked ) } /> Isärdragen</label>
					</div>
				</section>

				<section className="nbs-card nbs-hb-stack">
					<h2 className="nbs-h2">Kupan</h2>
					{ ! rows.length && <p className="nbs-muted">Tom. Börja med en botten.</p> }
					<ol className="nbs-hb-list" reversed>
						{ rows.map( ( r, i ) => ( { r, i } ) ).reverse().map( ( { r, i } ) => (
							<li key={ r.key } className={ selected === i ? 'is-selected' : '' } onClick={ () => setSelected( i ) }>
								<div className="nbs-hb-row">
									<strong>{ r.part.name }</strong>
									<span className="nbs-hb-actions">
										{ r.qty > 1 && <button type="button" className="nbs-link-btn" onClick={ ( e ) => ( e.stopPropagation(), split( i ) ) } title="Dela upp, så att något kan läggas emellan">Dela</button> }
										<button type="button" className="nbs-link-btn" onClick={ ( e ) => ( e.stopPropagation(), move( i, 1 ) ) } aria-label="Flytta upp">▲</button>
										<button type="button" className="nbs-link-btn" onClick={ ( e ) => ( e.stopPropagation(), move( i, -1 ) ) } aria-label="Flytta ner">▼</button>
										<button type="button" className="nbs-link-btn" onClick={ ( e ) => ( e.stopPropagation(), remove( i ) ) } aria-label="Ta bort">✕</button>
									</span>
								</div>
								<div className="nbs-hb-row">
									<label>Antal <input type="number" min="1" max="20" value={ r.qty } onChange={ ( e ) => update( i, { qty: Math.min( 20, Math.max( 1, parseInt( e.target.value, 10 ) || 1 ) ) } ) } /></label>
									{ r.part.kind === 'box' && (
										<label>Ramar/låda <input type="number" min="0" max={ r.part.frames } value={ r.frames } onChange={ ( e ) => update( i, { frames: Math.min( r.part.frames, Math.max( 0, parseInt( e.target.value, 10 ) || 0 ) ) } ) } /></label>
									) }
								</div>
								{ r.part.kind === 'box' && <small className="nbs-muted">{ frameName( r.part.frame ) }</small> }
							</li>
						) ) }
					</ol>
					{ warnings.map( ( w ) => <p key={ w } className="nbs-warn">{ w }</p> ) }
					{ rows.length > 0 && <p className="nbs-muted">Höjd ca { Math.round( height ) } mm.</p> }

					<h3 className="nbs-h3">Materiallista</h3>
					<label className="nbs-hb-count">Antal kupor <input type="number" min="1" value={ hives } onChange={ ( e ) => setHives( e.target.value ) } /></label>
					<table className="nbs-table">
						<thead><tr><th>Del</th><th>Per kupa</th><th>Totalt</th></tr></thead>
						<tbody>
							{ bomRows.map( ( b ) => <tr key={ b.name }><td>{ b.name }</td><td>{ b.qty }</td><td>{ b.qty * n }</td></tr> ) }
						</tbody>
					</table>
					<div className="nbs-row-actions">
						<Button variant="ghost" small onClick={ exportPng } disabled={ ! view3d || ! rows.length }>Spara bild</Button>
						<Button variant="ghost" small onClick={ exportGlb } disabled={ ! view3d || ! rows.length }>Spara 3D (GLB)</Button>
						{ rows.length > 0 && <Button variant="ghost" small onClick={ () => ( setStack( [] ), setSelected( null ) ) }>Töm</Button> }
					</div>
				</section>
			</div>
			{ naming !== null && <NameModal initial={ naming } onClose={ () => setNaming( null ) } onSave={ ( n ) => saveType( n, true ) } /> }
			{ applying && type && <ApplyModal type={ type } onClose={ () => setApplying( false ) } /> }
		</div>
	);
}

function NameModal( { initial, onClose, onSave } ) {
	const [ name, setName ] = useState( initial );
	return (
		<Modal title="Spara som kuptyp" onClose={ onClose } footer={ <><Button variant="ghost" onClick={ onClose }>Avbryt</Button><Button onClick={ () => onSave( name.trim() ) } disabled={ ! name.trim() }>Spara</Button></> }>
			<div className="nbs-field">
				<label htmlFor="nbs-hb-name">Namn</label>
				<input id="nbs-hb-name" type="text" value={ name } onChange={ ( e ) => setName( e.target.value ) } placeholder="T.ex. Produktionskupa Farrar 1+3" onKeyDown={ ( e ) => e.key === 'Enter' && name.trim() && onSave( name.trim() ) } />
				<small className="nbs-help">Kuptypen hamnar också i listan Kupsystem och kuptyper, som kuporna använder.</small>
			</div>
		</Modal>
	);
}

/**
 * Lägger ut en kuptyp: nya kupor i en bigård eller i befintliga kupor. Förhandsvisningen visar
 * vad som flyttas från lagret, vad som går tillbaka och vad som saknas.
 */
function ApplyModal( { type, onClose } ) {
	const reg = useRegister();
	const toast = useToast();
	const [ stock ] = useStock();
	const [ mode, setMode ] = useState( 'new' );
	const [ apiary, setApiary ] = useState( '' );
	const [ count, setCount ] = useState( 1 );
	const [ filter, setFilter ] = useState( '' );
	const [ picked, setPicked ] = useState( [] );
	const [ store, setStore ] = useState( '' );
	const [ book, setBook ] = useState( true );
	const [ buy, setBuy ] = useState( false );
	const [ keep, setKeep ] = useState( true );
	const [ date, setDate ] = useState( today() );
	const [ preview, setPreview ] = useState( null );
	const [ err, setErr ] = useState( null );
	const [ busy, setBusy ] = useState( false );

	const stores = stock ? stock.stores.filter( ( s ) => s.active ) : [];
	const storeId = store || ( stores[ 0 ] && stores[ 0 ].id ) || '';
	const apiaries = reg.apiaries.filter( ( a ) => a.active );
	const colonyIn = Object.fromEntries( reg.activeColonies.filter( ( c ) => c.hive_id ).map( ( c ) => [ c.hive_id, c ] ) );
	const hiveApiary = ( h ) => h.apiary_id || ( colonyIn[ h.id ] && colonyIn[ h.id ].apiary_id ) || '';
	const hives = reg.hives.filter( ( h ) => h.active && ( ! filter || hiveApiary( h ) === filter ) ).sort( ( a, b ) => String( a.label ).localeCompare( String( b.label ), 'sv', { numeric: true } ) );
	const body = { type_id: type.id, mode, apiary_id: apiary, count: parseInt( count, 10 ) || 0, hive_ids: picked, store_id: storeId, book, buy, keep_frames: keep, date };
	const ready = mode === 'new' ? apiary && body.count > 0 : picked.length > 0;

	useEffect( () => {
		if ( ! ready || ( book && ! storeId ) ) {
			setPreview( null );
			return;
		}
		let alive = true;
		const t = setTimeout( () => {
			api( 'hivetypes/apply', { method: 'POST', body: { ...body, dry: true } } ).then( ( r ) => alive && ( setPreview( r ), setErr( null ) ), ( e ) => alive && setErr( e ) );
		}, 250 );
		return () => {
			alive = false;
			clearTimeout( t );
		};
	}, [ JSON.stringify( body ) ] );

	const run = async () => {
		setBusy( true );
		try {
			const r = await api( 'hivetypes/apply', { method: 'POST', body } );
			await reg.reload();
			toast( mode === 'new' ? `${ r.hives.length } kupor lades till (${ r.hives.map( ( h ) => h.label ).join( ', ' ) }).` : `${ r.hives.length } kupor fick kuptypen ${ type.name }.` );
			onClose();
		} catch ( e ) {
			setErr( e );
		}
		setBusy( false );
	};
	const toggle = ( id ) => setPicked( ( p ) => ( p.includes( id ) ? p.filter( ( x ) => x !== id ) : [ ...p, id ] ) );
	const short = preview && preview.short;

	return (
		<Modal wide title={ 'Lägg ut kuptyp: ' + type.name } onClose={ onClose } footer={ <><Button variant="ghost" onClick={ onClose }>Avbryt</Button><Button onClick={ run } disabled={ busy || ! ready || ( book && ! storeId ) || ( short && ! buy ) }>{ busy ? 'Sparar…' : mode === 'new' ? `Lägg till ${ body.count || '' } kupor` : `Ersätt ${ picked.length } kupor` }</Button></> }>
			<div className="nbs-seg" role="group" aria-label="Vad ska göras">
				<button type="button" className={ mode === 'new' ? 'is-active' : '' } aria-pressed={ mode === 'new' } onClick={ () => setMode( 'new' ) }>Nya kupor i en bigård</button>
				<button type="button" className={ mode === 'replace' ? 'is-active' : '' } aria-pressed={ mode === 'replace' } onClick={ () => setMode( 'replace' ) }>Ersätt befintliga kupor</button>
			</div>

			{ mode === 'new' && (
				<div className="nbs-form-row">
					<div className="nbs-field">
						<label htmlFor="nbs-ap-apiary">Bigård</label>
						<select id="nbs-ap-apiary" value={ apiary } onChange={ ( e ) => setApiary( e.target.value ) }>
							<option value="">Välj…</option>
							{ apiaries.map( ( a ) => <option key={ a.id } value={ a.id }>{ a.name }</option> ) }
						</select>
					</div>
					<div className="nbs-field">
						<label htmlFor="nbs-ap-count">Antal kupor</label>
						<input id="nbs-ap-count" type="number" min="1" max="200" value={ count } onChange={ ( e ) => setCount( e.target.value ) } />
					</div>
				</div>
			) }

			{ mode === 'replace' && (
				<>
					<div className="nbs-toolbar">
						<select value={ filter } onChange={ ( e ) => setFilter( e.target.value ) } aria-label="Bigård">
							<option value="">Alla bigårdar</option>
							{ apiaries.map( ( a ) => <option key={ a.id } value={ a.id }>{ a.name }</option> ) }
						</select>
						<button type="button" className="nbs-link-btn" onClick={ () => setPicked( hives.every( ( h ) => picked.includes( h.id ) ) ? picked.filter( ( id ) => ! hives.some( ( h ) => h.id === id ) ) : [ ...new Set( [ ...picked, ...hives.map( ( h ) => h.id ) ] ) ] ) }>
							{ hives.length && hives.every( ( h ) => picked.includes( h.id ) ) ? 'Avmarkera alla' : `Markera alla (${ hives.length })` }
						</button>
					</div>
					<ul className="nbs-ap-hives">
						{ hives.map( ( h ) => {
							const c = colonyIn[ h.id ];
							const a = reg.apiary[ hiveApiary( h ) ];
							return (
								<li key={ h.id }>
									<label>
										<input type="checkbox" checked={ picked.includes( h.id ) } onChange={ () => toggle( h.id ) } />
										<strong>Kupa { h.label }</strong>
										<span className="nbs-muted">{ [ a && a.name, c && 'samhälle ' + c.code, reg.itemName( h.system_id ) ].filter( Boolean ).join( ' · ' ) || 'Tom' }</span>
									</label>
								</li>
							);
						} ) }
						{ ! hives.length && <li className="nbs-muted">Inga kupor.</li> }
					</ul>
					<label className="nbs-check"><input type="checkbox" checked={ keep } onChange={ ( e ) => setKeep( e.target.checked ) } /> Ta inte ut ramar ur kupor med samhälle (bina sitter kvar på ramarna; nya lådor får ändå ramar)</label>
				</>
			) }

			<fieldset className="nbs-fieldset">
				<legend>Lager</legend>
				<label className="nbs-check"><input type="checkbox" checked={ book } onChange={ ( e ) => setBook( e.target.checked ) } /> Boka materialet i lagret (det som saknas flyttas från lagret, det som blir över går tillbaka)</label>
				{ book && (
					<div className="nbs-form-row">
						<div className="nbs-field">
							<label htmlFor="nbs-ap-store">Lagerplats</label>
							<select id="nbs-ap-store" value={ storeId } onChange={ ( e ) => setStore( e.target.value ) }>
								{ stores.map( ( s ) => <option key={ s.id } value={ s.id }>{ s.name }</option> ) }
							</select>
						</div>
						<div className="nbs-field">
							<label htmlFor="nbs-ap-date">Datum</label>
							<input id="nbs-ap-date" type="date" value={ date } onChange={ ( e ) => setDate( e.target.value ) } />
						</div>
					</div>
				) }
				{ book && <label className="nbs-check"><input type="checkbox" checked={ buy } onChange={ ( e ) => setBuy( e.target.checked ) } /> Registrera inköp av det som saknas</label> }
			</fieldset>

			<ErrorBox error={ err } />
			{ ready && ! preview && ! err && <Loading /> }
			{ preview && (
				<>
					{ book && preview.items.length > 0 && (
						<table className="nbs-table">
							<thead><tr><th>Artikel</th><th>Till kuporna</th><th>Tillbaka till lagret</th><th>I lagret</th><th>Saknas</th></tr></thead>
							<tbody>
								{ preview.items.map( ( i ) => (
									<tr key={ i.item_id } className={ i.short > 0 ? 'is-short' : '' }>
										<td>{ i.name }{ String( i.item_id ).startsWith( 'new:' ) && <small className="nbs-muted"> (skapas som ny artikel)</small> }</td>
										<td>{ fmtQty( i.need ) }</td>
										<td>{ fmtQty( i.back ) }</td>
										<td>{ fmtQty( i.store ) }</td>
										<td>{ i.short > 0 ? <strong>{ fmtQty( i.short ) }</strong> : '–' }</td>
									</tr>
								) ) }
							</tbody>
						</table>
					) }
					{ book && ! preview.items.length && <p className="nbs-muted">Kuporna har redan rätt material – inget behöver flyttas.</p> }
					{ short && ! buy && <p className="nbs-warn">Det saknas material i lagret. Registrera inköpet först eller kryssa i "Registrera inköp av det som saknas".</p> }
					<p className="nbs-muted">
						{ mode === 'new' ? `Nya kupor: ${ preview.hives.map( ( h ) => h.label ).join( ', ' ) }.` : `${ preview.hives.length } kupor får kuptypen ${ type.name }.` }
						{ book && ' Lagerbokningen kan ångras under Lager → Rörelser; kuptypen på kuporna ändras då inte tillbaka.' }
					</p>
				</>
			) }
		</Modal>
	);
}
