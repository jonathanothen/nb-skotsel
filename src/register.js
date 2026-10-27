import { createContext, useContext, useMemo, useState, useEffect, useCallback } from '@wordpress/element';
import { api } from './api';

/**
 * Registret (bigårdar, kupor, samhällen, drottningar) laddas i ett anrop och delas av
 * vyerna. Efter varje ändring laddas det om, så att kopplingar alltid stämmer.
 */

export const COLONY_STATUS = [
	[ 'produktion', 'Produktion' ],
	[ 'avlaggare', 'Avläggare' ],
	[ 'samuel', 'Samuel' ],
	[ 'parning', 'Parningskupa' ],
	[ 'dod', 'Död' ],
	[ 'sald', 'Såld' ],
	[ 'sammanslagen', 'Sammanslagen' ],
];
export const QUEEN_STATUS = [
	[ 'parad', 'Parad' ],
	[ 'oparad', 'Oparad' ],
	[ 'ersatt', 'Ersatt' ],
	[ 'dod', 'Död' ],
	[ 'sald', 'Såld' ],
	[ 'forsvunnen', 'Försvunnen' ],
];
export const MATING = [
	[ '', 'Okänd' ],
	[ 'fri', 'Fri parning' ],
	[ 'station', 'Parningsstation' ],
	[ 'moonshine', 'Moonshine-parning' ],
	[ 'instrumentell', 'Instrumentell' ],
];
export const COLONY_ACTIVE = [ 'produktion', 'avlaggare', 'samuel', 'parning' ];
export const QUEEN_ACTIVE = [ 'parad', 'oparad' ];

export const label = ( pairs, v ) => ( pairs.find( ( p ) => p[ 0 ] === ( v || '' ) ) || [ v, v || '–' ] )[ 1 ];
export const today = () => {
	const d = new Date();
	return `${ d.getFullYear() }-${ String( d.getMonth() + 1 ).padStart( 2, '0' ) }-${ String( d.getDate() ).padStart( 2, '0' ) }`;
};
/** Datum visas som ÅÅÅÅ-MM-DD (svensk standard). */
export const fmtDate = ( d ) => ( d ? String( d ).slice( 0, 10 ) : '' );

const RegCtx = createContext( null );
export const useRegister = () => useContext( RegCtx );

export function RegisterProvider( { children } ) {
	const [ data, setData ] = useState( null );
	const [ error, setError ] = useState( null );
	// reload returnerar ett löfte, så att en vy kan vänta in nya poster innan den navigerar.
	const reload = useCallback(
		() =>
			Promise.all( [ api( 'register' ), api( 'refs' ), api( 'lists' ) ] ).then(
				( d ) => {
					setData( d );
					setError( null );
				},
				( e ) => setError( e )
			),
		[]
	);
	useEffect( () => {
		reload();
	}, [ reload ] );
	const value = useMemo( () => {
		if ( ! data ) {
			return { loading: true, error, reload };
		}
		const [ reg, refs, lists ] = data;
		const byId = ( arr ) => Object.fromEntries( arr.map( ( x ) => [ x.id, x ] ) );
		const apiary = byId( reg.apiaries );
		const hive = byId( reg.hives );
		const colony = byId( reg.colonies );
		const queen = byId( reg.queens );
		const items = {};
		const listItems = Object.values( refs ).flat();
		listItems.forEach( ( i ) => ( items[ i.id ] = i ) );
		const activeColonies = reg.colonies.filter( ( c ) => COLONY_ACTIVE.includes( c.status ) );
		const coloniesIn = ( apiaryId ) => activeColonies.filter( ( c ) => c.apiary_id === apiaryId );
		// Valbara poster för fält av typen "ref" (egna listor + registren).
		const allRefs = {
			...refs,
			'@apiary': reg.apiaries.map( ( a ) => ( { id: a.id, name: a.name, active: a.active } ) ),
			'@hive': reg.hives.map( ( h ) => ( { id: h.id, name: h.label, active: h.active } ) ),
			'@colony': reg.colonies.map( ( c ) => ( { id: c.id, name: c.code, active: COLONY_ACTIVE.includes( c.status ) } ) ),
			'@queen': reg.queens.map( ( q ) => ( { id: q.id, name: q.code + ( q.year ? ` (${ q.year })` : '' ), active: QUEEN_ACTIVE.includes( q.status ) } ) ),
		};
		return {
			...reg,
			lists,
			refs: allRefs,
			apiary,
			hive,
			colony,
			queen,
			item: ( id ) => items[ id ],
			itemName: ( id ) => ( items[ id ] ? items[ id ].name : '' ),
			itemColor: ( id ) => ( items[ id ] && items[ id ].color ) || null,
			activeColonies,
			coloniesIn,
			reload,
			error,
		};
	}, [ data, error, reload ] );
	return <RegCtx.Provider value={ value }>{ children }</RegCtx.Provider>;
}
