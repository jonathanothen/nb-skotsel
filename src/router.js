import { useEffect, useState } from '@wordpress/element';

/**
 * Enkel hash-router (#/listor/<id>) som fungerar både på /skotsel/ och i WP-admin.
 */
export function useRoute() {
	const read = () => window.location.hash.replace( /^#\/?/, '' ).split( '/' ).filter( Boolean );
	const [ parts, setParts ] = useState( read );
	useEffect( () => {
		const on = () => setParts( read() );
		window.addEventListener( 'hashchange', on );
		return () => window.removeEventListener( 'hashchange', on );
	}, [] );
	return parts;
}

export function go( path ) {
	window.location.hash = '#/' + path.replace( /^\//, '' );
}

export function href( path ) {
	return '#/' + path.replace( /^\//, '' );
}
