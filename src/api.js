/**
 * Tunn wrapper runt plugin-API:t (/wp-json/nbs/v1/). Kastar Error med serverns
 * felmeddelande så att vyerna kan visa det direkt.
 */
const cfg = window.NBS || {};

export async function api( path, { method = 'GET', body } = {} ) {
	const res = await fetch( cfg.root + path.replace( /^\//, '' ), {
		method,
		credentials: 'same-origin',
		headers: {
			'X-WP-Nonce': cfg.nonce,
			...( body !== undefined ? { 'Content-Type': 'application/json' } : {} ),
		},
		body: body !== undefined ? JSON.stringify( body ) : undefined,
	} );
	const text = await res.text();
	let data = null;
	try {
		data = text ? JSON.parse( text ) : null;
	} catch ( e ) {
		data = null;
	}
	if ( ! res.ok ) {
		const msg = ( data && data.message ) || `Något gick fel (${ res.status }).`;
		throw new Error( msg );
	}
	return data;
}

export const config = cfg;

/** UUID v4 skapas i appen, så att poster får sitt id direkt (förberett för offline). */
export function uuid() {
	if ( window.crypto && window.crypto.randomUUID ) {
		return window.crypto.randomUUID();
	}
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace( /[xy]/g, ( c ) => {
		const r = ( Math.random() * 16 ) | 0;
		return ( c === 'x' ? r : ( r & 0x3 ) | 0x8 ).toString( 16 );
	} );
}
