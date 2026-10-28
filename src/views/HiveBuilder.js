import { useEffect, useRef, useState } from '@wordpress/element';
import { api } from '../api';
import { useLoad, Loading, ErrorBox, Button, useToast } from '../ui';
import { useMe } from '../App';
import { download } from '../xlsx';

const KINDS = { bottom: 'Botten', box: 'Låda', roof: 'Tak' };
// Ordning nerifrån och upp när en del läggs till.
const RANK = { bottom: 0, box: 5, roof: 9 };
const STORE = 'nbs_hivebuilder';

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
	const partById = ( id ) => lib && lib.parts.find( ( p ) => p.id === id );
	const rows = stack.map( ( s ) => ( { ...s, part: partById( s.part ) } ) ).filter( ( s ) => s.part );
	const frameName = ( id ) => ( ( lib && lib.frames.find( ( f ) => f.id === id ) ) || { name: id } ).name;

	useEffect( () => {
		try {
			window.localStorage.setItem( STORE, JSON.stringify( { system, stack, hives } ) );
		} catch ( e ) {}
	}, [ system, stack, hives ] );

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
			const same = st.findIndex( ( s ) => s.part === id );
			if ( same >= 0 && p.kind === 'box' ) {
				return st.map( ( s, i ) => ( i === same ? { ...s, qty: s.qty + 1 } : s ) );
			}
			const item = { key: Date.now() + '-' + Math.random().toString( 36 ).slice( 2, 6 ), part: id, qty: 1, frames: p.kind === 'box' ? p.frames || 0 : 0 };
			const rank = RANK[ p.kind ] ?? 5;
			let at = st.length;
			while ( at > 0 && ( RANK[ ( partById( st[ at - 1 ].part ) || {} ).kind ] ?? 5 ) > rank ) {
				at--;
			}
			return [ ...st.slice( 0, at ), item, ...st.slice( at ) ];
		} );
	};
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

			<div className="nbs-hb-grid">
				<section className="nbs-card nbs-hb-palette">
					<label className="nbs-field">
						<span>System</span>
						<select value={ sys ? sys.id : '' } onChange={ ( e ) => setSystem( e.target.value ) }>
							{ systems.map( ( s ) => <option key={ s.id } value={ s.id }>{ s.name } – { ( lib.brands.find( ( b ) => b.id === s.brand ) || { name: s.brand } ).name }</option> ) }
						</select>
					</label>
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
		</div>
	);
}
