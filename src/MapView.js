import { useEffect, useRef } from '@wordpress/element';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** Östervåla som startläge när inga bigårdar har position. */
const HOME = [ 60.18, 17.18 ];

/**
 * Karta med OpenStreetMap. points = [{ id, lat, lng, color, label, sub }].
 * Med onPick blir kartan en positionsväljare: klick sätter markören.
 * Punkter med n (t.ex. 1, 2, S, M) ritas som numrerade nålar; line = [[lat, lng]…] ritar en körväg.
 */
export default function MapView( { points = [], onOpen, pick, onPick, line, height = 420 } ) {
	const el = useRef();
	const map = useRef();
	const layer = useRef();

	useEffect( () => {
		map.current = L.map( el.current, { scrollWheelZoom: false } ).setView( HOME, 9 );
		L.tileLayer( 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
			maxZoom: 18,
			attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
		} ).addTo( map.current );
		layer.current = L.layerGroup().addTo( map.current );
		map.current.on( 'focus', () => map.current.scrollWheelZoom.enable() );
		map.current.on( 'blur', () => map.current.scrollWheelZoom.disable() );
		return () => map.current.remove();
	}, [] );

	useEffect( () => {
		if ( ! onPick ) {
			return;
		}
		const click = ( e ) => onPick( { lat: +e.latlng.lat.toFixed( 6 ), lng: +e.latlng.lng.toFixed( 6 ) } );
		map.current.on( 'click', click );
		return () => map.current.off( 'click', click );
	}, [ onPick ] );

	useEffect( () => {
		const g = layer.current;
		g.clearLayers();
		const placed = points.filter( ( p ) => p.lat !== null && p.lng !== null && p.lat !== undefined );
		placed.forEach( ( p ) => {
			const m = p.n !== undefined
				? L.marker( [ p.lat, p.lng ], { icon: L.divIcon( { className: 'nbs-pin', html: `<span style="background:${ p.color || '#3B2A1A' }">${ String( p.n ).replace( /[<>&]/g, '' ) }</span>`, iconSize: [ 28, 28 ], iconAnchor: [ 14, 14 ] } ) } ).addTo( g )
				: L.circleMarker( [ p.lat, p.lng ], { radius: 9, color: '#2B2620', weight: 1.5, fillColor: p.color || '#D99A2B', fillOpacity: 0.95 } ).addTo( g );
			const tip = document.createElement( 'div' );
			const b = document.createElement( 'strong' );
			b.textContent = p.label;
			tip.appendChild( b );
			if ( p.sub ) {
				tip.appendChild( document.createElement( 'br' ) );
				tip.appendChild( document.createTextNode( p.sub ) );
			}
			m.bindTooltip( tip, { direction: 'top', offset: [ 0, -8 ] } );
			if ( onOpen ) {
				m.on( 'click', () => onOpen( p.id ) );
			}
		} );
		if ( pick && pick.lat !== null && pick.lat !== undefined ) {
			L.circleMarker( [ pick.lat, pick.lng ], { radius: 10, color: '#2B2620', weight: 2, fillColor: '#D99A2B', fillOpacity: 1 } ).addTo( g );
		}
		if ( line && line.length > 1 ) {
			L.polyline( line, { color: '#A8741A', weight: 5, opacity: 0.85 } ).addTo( g );
		}
		const all = placed.map( ( p ) => [ p.lat, p.lng ] );
		if ( pick && pick.lat !== null && pick.lat !== undefined ) {
			all.push( [ pick.lat, pick.lng ] );
		}
		if ( all.length > 1 ) {
			map.current.fitBounds( all, { padding: [ 30, 30 ], maxZoom: 13 } );
		} else if ( all.length === 1 ) {
			map.current.setView( all[ 0 ], Math.max( map.current.getZoom(), 12 ) );
		}
		// Jämför innehållet, inte arrayen, så att kartan inte zoomar om vid varje omritning.
	}, [ JSON.stringify( points ), pick && pick.lat, pick && pick.lng, line && line.length ] ); // eslint-disable-line react-hooks/exhaustive-deps

	return <div ref={ el } className="nbs-map" style={ { height } } />;
}
