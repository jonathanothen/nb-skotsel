import { href } from './router';

/** Vad en kontrollpunkt på ett aktivitetskort kan länka till i övriga CMS:et. Samma lista finns i PHP (NBS_Visits::LINK_TYPES). */
export const LINK_TYPES = [
	[ 'plan', 'Aktivitet' ],
	[ 'apiary', 'Bigård' ],
	[ 'colony', 'Samhälle' ],
	[ 'template', 'Skötselkort' ],
	[ 'stock', 'Lagerartikel' ],
];

/** Alternativen för en länktyp. ctx = { reg, plan, templates, stock } (det som saknas ger tomma listor). */
export function linkOptions( type, ctx ) {
	switch ( type ) {
		case 'plan':
			return ( ctx.plan || [] ).filter( ( p ) => p.kind !== 'drag' ).map( ( p ) => ( { id: p.id, name: `${ p.name } (v. ${ p.week_start })` } ) );
		case 'apiary':
			return ( ( ctx.reg && ctx.reg.apiaries ) || [] ).map( ( a ) => ( { id: a.id, name: a.name } ) );
		case 'colony':
			return ( ( ctx.reg && ctx.reg.colonies ) || [] ).map( ( c ) => ( { id: c.id, name: 'Samhälle ' + c.code } ) );
		case 'template':
			return ( ctx.templates || [] ).filter( ( t ) => ! t.archived ).map( ( t ) => ( { id: t.id, name: t.name } ) );
		case 'stock':
			return ( ( ctx.stock && ctx.stock.items ) || [] ).filter( ( i ) => i.active ).map( ( i ) => ( { id: i.id, name: i.name } ) );
		default:
			return [];
	}
}

/** Text och adress för en länk, eller null. */
export function linkInfo( link, ctx ) {
	if ( ! link || ! link.type ) {
		return null;
	}
	const found = linkOptions( link.type, ctx ).find( ( o ) => o.id === link.id );
	const urls = {
		plan: 'driftplan',
		apiary: 'bigardar/' + link.id,
		colony: 'samhallen/' + link.id,
		template: 'besok/kort/' + link.id,
		stock: 'lager/artikel/' + link.id,
	};
	const kind = ( LINK_TYPES.find( ( t ) => t[ 0 ] === link.type ) || [ '', '' ] )[ 1 ];
	return { text: found ? found.name : `${ kind } (borttagen)`, kind, url: urls[ link.type ] ? href( urls[ link.type ] ) : null };
}

/** Två väljare: vad man länkar till och vilken post. */
export function LinkPicker( { link, onChange, ctx, label = 'Länk' } ) {
	const type = link ? link.type : '';
	const opts = type ? linkOptions( type, ctx ) : [];
	return (
		<span className="nbs-link-picker">
			<select value={ type } onChange={ ( e ) => onChange( e.target.value ? { type: e.target.value, id: '' } : null ) } aria-label={ `${ label }: typ` }>
				<option value="">Ingen länk</option>
				{ LINK_TYPES.map( ( [ k, name ] ) => <option key={ k } value={ k }>{ name }</option> ) }
			</select>
			{ type && (
				<select value={ link.id || '' } onChange={ ( e ) => onChange( e.target.value ? { type, id: e.target.value } : { type, id: '' } ) } aria-label={ `${ label }: post` }>
					<option value="">Välj …</option>
					{ opts.map( ( o ) => <option key={ o.id } value={ o.id }>{ o.name }</option> ) }
				</select>
			) }
		</span>
	);
}
