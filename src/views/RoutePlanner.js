import { useState, useEffect, useMemo } from '@wordpress/element';
import { href } from '../router';
import { useRegister } from '../register';
import { Button, ErrorBox } from '../ui';
import MapView from '../MapView';
import { googleParts, appleRoute, route, durationTable, optimizeOrder, distance, parseCoords, fmtKm, fmtDuration, GOOGLE_MAX } from '../geo';

const KEY = 'nbs_rutt';
const has = ( a ) => a && a.lat !== null && a.lat !== undefined;

function load() {
	try {
		const o = JSON.parse( localStorage.getItem( KEY ) || 'null' );
		return o && typeof o === 'object' ? o : null;
	} catch ( e ) {
		return null;
	}
}

/**
 * Körplanering för bigårdsbesök: välj bigårdar (gärna en hel slinga), start och mål,
 * ordna eller optimera ordningen, se körtid och km, och öppna rutten i Google Maps
 * eller Apple Kartor. Planen sparas i webbläsaren.
 */
export default function RoutePlanner( { routeId } ) {
	const reg = useRegister();
	const placed = reg.apiaries.filter( ( a ) => a.active && has( a ) );
	const home = placed.find( ( a ) => /österbo|gården/i.test( a.name ) );
	const saved = load();
	const [ stops, setStops ] = useState( () => ( saved && saved.stops ? saved.stops : [] ) );
	const [ start, setStart ] = useState( () => ( saved && saved.start !== undefined ? saved.start : home ? { kind: 'apiary', id: home.id } : null ) );
	const [ endSame, setEndSame ] = useState( () => ( saved ? saved.endSame !== false : true ) );
	const [ end, setEnd ] = useState( () => ( saved && saved.end ) || null );
	const [ stopMin, setStopMin ] = useState( () => ( saved && saved.stopMin ) || 45 );
	const [ depart, setDepart ] = useState( () => ( saved && saved.depart ) || '07:30' );
	const [ info, setInfo ] = useState( null );
	const [ routeErr, setRouteErr ] = useState( null );
	const [ busy, setBusy ] = useState( false );
	const [ custom, setCustom ] = useState( '' );
	const [ gpsErr, setGpsErr ] = useState( null );

	// #/bigardar/rutt/<slinga> väljer slingans bigårdar.
	useEffect( () => {
		if ( routeId ) {
			setStops( placed.filter( ( a ) => a.route_id === routeId && a.id !== ( home && home.id ) ).map( ( a ) => a.id ) );
		}
	}, [ routeId ] ); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect( () => {
		try {
			localStorage.setItem( KEY, JSON.stringify( { stops, start, endSame, end, stopMin, depart } ) );
		} catch ( e ) {
			/* privat läge */
		}
	}, [ stops, start, endSame, end, stopMin, depart ] );

	const resolveEnd = ( e ) => {
		if ( ! e ) {
			return null;
		}
		if ( e.kind === 'apiary' ) {
			const a = reg.apiary[ e.id ];
			return a && has( a ) ? { lat: a.lat, lng: a.lng, name: a.name } : null;
		}
		return { lat: e.lat, lng: e.lng, name: e.label || 'Vald plats' };
	};
	const startPt = resolveEnd( start );
	const endPt = endSame ? startPt : resolveEnd( end );
	const list = stops.map( ( id ) => reg.apiary[ id ] ).filter( ( a ) => a && has( a ) );
	const points = useMemo( () => [ ...( startPt ? [ { ...startPt, kind: 'start' } ] : [] ), ...list.map( ( a ) => ( { lat: a.lat, lng: a.lng, name: a.name, id: a.id, kind: 'stop' } ) ), ...( endPt ? [ { ...endPt, kind: 'end' } ] : [] ) ], [ JSON.stringify( [ startPt, endPt, stops ] ) ] ); // eslint-disable-line react-hooks/exhaustive-deps
	const key = points.map( ( p ) => `${ p.lat },${ p.lng }` ).join( ';' );

	// Körväg från OSRM när punkterna ändras.
	useEffect( () => {
		setInfo( null );
		setRouteErr( null );
		if ( points.length < 2 ) {
			return;
		}
		let alive = true;
		const t = setTimeout( () => {
			route( points ).then(
				( r ) => alive && setInfo( r ),
				() => alive && setRouteErr( 'Körtiden kunde inte hämtas just nu. Länkarna till Google Maps och Apple Kartor fungerar ändå.' )
			);
		}, 300 );
		return () => {
			alive = false;
			clearTimeout( t );
		};
	}, [ key ] ); // eslint-disable-line react-hooks/exhaustive-deps

	const toggle = ( id ) => setStops( ( s ) => ( s.includes( id ) ? s.filter( ( x ) => x !== id ) : [ ...s, id ] ) );
	const move = ( i, d ) =>
		setStops( ( s ) => {
			const a = [ ...s ];
			const j = i + d;
			if ( j < 0 || j >= a.length ) {
				return a;
			}
			[ a[ i ], a[ j ] ] = [ a[ j ], a[ i ] ];
			return a;
		} );

	const optimize = async () => {
		if ( list.length < 2 ) {
			return;
		}
		setBusy( true );
		// Punkt 0 = start (eller första stoppet), sist = mål om det finns.
		const origin = startPt || list[ 0 ];
		const rest = startPt ? list : list.slice( 1 );
		const pts = [ origin, ...rest, ...( endPt ? [ endPt ] : [] ) ];
		let cost = ( i, j ) => distance( pts[ i ], pts[ j ] );
		try {
			const table = await durationTable( pts );
			cost = ( i, j ) => table[ i ][ j ];
		} catch ( e ) {
			/* fågelvägen räcker som reserv */
		}
		const order = optimizeOrder( rest.length, cost, !! endPt );
		const sorted = order.map( ( i ) => rest[ i - 1 ].id );
		setStops( startPt ? sorted : [ list[ 0 ].id, ...sorted ] );
		setBusy( false );
	};

	const useGps = () => {
		setGpsErr( null );
		if ( ! navigator.geolocation ) {
			setGpsErr( 'Webbläsaren kan inte ge din position.' );
			return;
		}
		navigator.geolocation.getCurrentPosition(
			( p ) => setStart( { kind: 'pos', lat: +p.coords.latitude.toFixed( 6 ), lng: +p.coords.longitude.toFixed( 6 ), label: 'Min position' } ),
			() => setGpsErr( 'Positionen kunde inte hämtas. Tillåt platsåtkomst och försök igen.' ),
			{ enableHighAccuracy: true, timeout: 10000 }
		);
	};

	const applyCustom = () => {
		const c = parseCoords( custom );
		if ( c ) {
			setStart( { kind: 'pos', ...c, label: 'Vald plats' } );
			setCustom( '' );
		} else {
			setGpsErr( 'Hittade inga koordinater. Klistra in t.ex. 60.18, 17.18 eller en länk från Google Maps.' );
		}
	};

	// Ankomsttider: avresa + körtid + tid i varje bigård.
	const schedule = useMemo( () => {
		if ( ! info ) {
			return null;
		}
		const [ h, m ] = String( depart || '07:30' ).split( ':' ).map( Number );
		let t = ( h || 0 ) * 60 + ( m || 0 );
		const offset = startPt ? 0 : -1; // utan start är första stoppet utgångspunkt
		const rows = list.map( ( a, i ) => {
			const leg = info.legs[ i + offset ];
			if ( leg ) {
				t += leg.duration / 60;
			}
			const arrive = t;
			t += Number( stopMin ) || 0;
			return { arrive, leg };
		} );
		const lastLeg = endPt ? info.legs[ info.legs.length - 1 ] : null;
		return { rows, home: endPt && lastLeg ? t + lastLeg.duration / 60 : t, work: list.length * ( Number( stopMin ) || 0 ) };
	}, [ info, depart, stopMin, list.length ] ); // eslint-disable-line react-hooks/exhaustive-deps
	const clock = ( min ) => `${ String( Math.floor( min / 60 ) % 24 ).padStart( 2, '0' ) }:${ String( Math.round( min % 60 ) ).padStart( 2, '0' ) }`.replace( ':60', ':59' );

	const groups = {};
	reg.apiaries.filter( ( a ) => a.active ).forEach( ( a ) => ( groups[ a.route_id || '' ] = groups[ a.route_id || '' ] || [] ).push( a ) );
	const parts = points.length ? googleParts( points ) : [];
	const missing = reg.apiaries.filter( ( a ) => a.active && ! has( a ) ).length;

	const endSelect = ( value, onChange, idp ) => (
		<select id={ idp } value={ value && value.kind === 'apiary' ? value.id : value ? '_pos' : '' } onChange={ ( e ) => onChange( e.target.value ? ( e.target.value === '_pos' ? value : { kind: 'apiary', id: e.target.value } ) : null ) }>
			<option value="">Ingen – börja vid första bigården</option>
			{ value && value.kind === 'pos' && <option value="_pos">{ value.label } ({ String( value.lat ).replace( '.', ',' ) }, { String( value.lng ).replace( '.', ',' ) })</option> }
			{ placed.map( ( a ) => <option key={ a.id } value={ a.id }>{ a.name }</option> ) }
		</select>
	);

	return (
		<div className="nbs-page">
			<a className="nbs-back" href={ href( 'bigardar' ) }>← Bigårdar</a>
			<header className="nbs-page-head">
				<div>
					<h1 className="nbs-h1">Planera körning</h1>
					<p className="nbs-muted">Välj bigårdar, ordna besöken och öppna rutten i Google Maps eller Apple Kartor.</p>
				</div>
			</header>

			<div className="nbs-route-grid">
				<div className="nbs-route-side">
					<section className="nbs-card">
						<h2 className="nbs-h2">Start och mål</h2>
						<div className="nbs-field">
							<label htmlFor="nbs-r-start">Start</label>
							{ endSelect( start, setStart, 'nbs-r-start' ) }
							<div className="nbs-row-actions nbs-gps">
								<Button small variant="ghost" onClick={ useGps }>Använd min position</Button>
							</div>
							<div className="nbs-inline-form">
								<input type="text" value={ custom } onChange={ ( e ) => setCustom( e.target.value ) } placeholder="Eller klistra in koordinater / Google Maps-länk" aria-label="Startpunkt som koordinater eller länk" />
								<Button small variant="ghost" onClick={ applyCustom } disabled={ ! custom.trim() }>Använd</Button>
							</div>
							{ gpsErr && <small className="nbs-warn">{ gpsErr }</small> }
						</div>
						<label className="nbs-inline-check"><input type="checkbox" checked={ endSame } onChange={ ( e ) => setEndSame( e.target.checked ) } /> Tillbaka till start</label>
						{ ! endSame && (
							<div className="nbs-field">
								<label htmlFor="nbs-r-end">Mål</label>
								{ endSelect( end, setEnd, 'nbs-r-end' ) }
							</div>
						) }
						<div className="nbs-form-row">
							<div className="nbs-field">
								<label htmlFor="nbs-r-dep">Avresa</label>
								<input id="nbs-r-dep" type="time" value={ depart } onChange={ ( e ) => setDepart( e.target.value ) } />
							</div>
							<div className="nbs-field">
								<label htmlFor="nbs-r-stop">Tid per bigård (min)</label>
								<input id="nbs-r-stop" type="number" min="0" step="5" value={ stopMin } onChange={ ( e ) => setStopMin( e.target.value ) } />
							</div>
						</div>
					</section>

					<section className="nbs-card">
						<div className="nbs-card-head">
							<h2 className="nbs-h2">Bigårdar</h2>
							{ stops.length > 0 && <button type="button" className="nbs-link-btn" onClick={ () => setStops( [] ) }>Rensa</button> }
						</div>
						{ missing > 0 && <p className="nbs-muted">{ missing } bigårdar saknar position och kan inte väljas. Lägg in position under Redigera på bigården.</p> }
						{ Object.entries( groups ).map( ( [ rid, arr ] ) => (
							<div key={ rid || 'none' } className="nbs-route-group">
								<div className="nbs-route-group-head">
									<strong>{ rid ? reg.itemName( rid ) : 'Utan slinga' }</strong>
									{ rid && <button type="button" className="nbs-link-btn" onClick={ () => setStops( ( s ) => [ ...s, ...arr.filter( ( a ) => has( a ) && ! s.includes( a.id ) && ( ! start || start.id !== a.id ) ).map( ( a ) => a.id ) ] ) }>Lägg till hela slingan</button> }
								</div>
								{ arr.map( ( a ) => (
									<label key={ a.id } className={ `nbs-check-pill${ stops.includes( a.id ) ? ' is-on' : '' }${ has( a ) ? '' : ' is-disabled' }` }>
										<input type="checkbox" checked={ stops.includes( a.id ) } disabled={ ! has( a ) } onChange={ () => toggle( a.id ) } />{ a.name }
									</label>
								) ) }
							</div>
						) ) }
					</section>
				</div>

				<div className="nbs-route-main">
					<section className="nbs-card">
						<div className="nbs-card-head">
							<h2 className="nbs-h2">Körordning</h2>
							{ list.length > 2 && <Button small variant="ghost" onClick={ optimize } disabled={ busy }>{ busy ? 'Räknar…' : 'Optimera ordningen' }</Button> }
						</div>
						{ list.length === 0 ? (
							<p className="nbs-muted">Välj bigårdar till vänster, eller lägg till en hel slinga.</p>
						) : (
							<>
								<ol className="nbs-route-list">
									{ startPt && <li className="is-end"><span className="nbs-rn">S</span><div><strong>{ startPt.name }</strong><small className="nbs-muted">Avresa { depart }</small></div></li> }
									{ list.map( ( a, i ) => {
										const row = schedule && schedule.rows[ i ];
										const n = reg.coloniesIn( a.id ).length;
										return (
											<li key={ a.id }>
												<span className="nbs-rn">{ i + 1 }</span>
												<div>
													<a href={ href( 'bigardar/' + a.id ) }><strong>{ a.name }</strong></a>
													<small className="nbs-muted">
														{ n } samhällen{ row && row.leg && ` · ${ fmtDuration( row.leg.duration ) }, ${ fmtKm( row.leg.distance ) }` }{ row && ` · framme ca ${ clock( row.arrive ) }` }
													</small>
												</div>
												<span className="nbs-route-btns">
													<button type="button" className="nbs-icon-btn" onClick={ () => move( i, -1 ) } disabled={ i === 0 } aria-label={ `Flytta ${ a.name } upp` }>↑</button>
													<button type="button" className="nbs-icon-btn" onClick={ () => move( i, 1 ) } disabled={ i === list.length - 1 } aria-label={ `Flytta ${ a.name } ned` }>↓</button>
													<button type="button" className="nbs-icon-btn" onClick={ () => toggle( a.id ) } aria-label={ `Ta bort ${ a.name }` }>×</button>
												</span>
											</li>
										);
									} ) }
									{ endPt && <li className="is-end"><span className="nbs-rn">M</span><div><strong>{ endPt.name }</strong>{ schedule && <small className="nbs-muted">Tillbaka ca { clock( schedule.home ) }</small> }</div></li> }
								</ol>
								{ info && (
									<p className="nbs-route-sum">
										<strong>{ list.length } bigårdar</strong> · { fmtKm( info.distance ) } · körtid { fmtDuration( info.duration ) } · i bigårdarna { fmtDuration( schedule.work * 60 ) } · <strong>totalt { fmtDuration( info.duration + schedule.work * 60 ) }</strong>
									</p>
								) }
								<ErrorBox error={ routeErr } />
								<div className="nbs-route-open">
									{ parts.map( ( p, i ) => (
										<a key={ i } className="nbs-btn is-primary" href={ p.url } target="_blank" rel="noopener noreferrer">
											{ parts.length > 1 ? `Google Maps del ${ i + 1 }` : 'Öppna i Google Maps' }
										</a>
									) ) }
									<a className="nbs-btn is-ghost" href={ appleRoute( points ) } target="_blank" rel="noopener noreferrer">Öppna i Apple Kartor</a>
									<Button variant="ghost" onClick={ () => window.print() }>Skriv ut körlista</Button>
								</div>
								{ parts.length > 1 && <p className="nbs-muted">Google Maps tar högst { GOOGLE_MAX - 2 } stopp per länk, så rutten är delad. Varje del börjar där den förra slutade.</p> }
							</>
						) }
					</section>
					{ points.length > 0 && (
						<MapView
							height={ 420 }
							line={ info ? info.geom : points.map( ( p ) => [ p.lat, p.lng ] ) }
							points={ points.map( ( p, i ) => ( { id: p.id || p.kind + i, lat: p.lat, lng: p.lng, label: p.name, n: p.kind === 'start' ? 'S' : p.kind === 'end' ? ( endSame ? 'S' : 'M' ) : ( startPt ? i : i + 1 ), color: p.kind === 'stop' ? '#A8741A' : '#3B2A1A' } ) ) }
						/>
					) }
				</div>
			</div>
		</div>
	);
}
