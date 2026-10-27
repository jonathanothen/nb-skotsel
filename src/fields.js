/**
 * Fälttyper för egna listor: redigering (FieldInput) och visning (formatValue).
 */
export const FIELD_TYPES = [
	[ 'text', 'Text' ],
	[ 'textarea', 'Lång text' ],
	[ 'number', 'Tal' ],
	[ 'select', 'Val ur lista' ],
	[ 'multiselect', 'Flera val' ],
	[ 'bool', 'Ja/nej' ],
	[ 'date', 'Datum' ],
	[ 'ref', 'Koppling till annan lista' ],
	[ 'color', 'Färg' ],
	[ 'url', 'Länk' ],
];

/** Alternativ kan vara strängar eller [värde, etikett]. */
const opt = ( o ) => ( Array.isArray( o ) ? o : [ o, o ] );

export const typeLabel = ( t ) => ( FIELD_TYPES.find( ( x ) => x[ 0 ] === t ) || [ t, t ] )[ 1 ];

export function formatValue( field, value, refs ) {
	if ( value === undefined || value === null || value === '' ) {
		return '';
	}
	switch ( field.type ) {
		case 'bool':
			return value ? 'Ja' : 'Nej';
		case 'number':
			return String( value ).replace( '.', ',' ) + ( field.unit ? ' ' + field.unit : '' );
		case 'select': {
			const hit = ( field.options || [] ).map( opt ).find( ( o ) => o[ 0 ] === value );
			return hit ? hit[ 1 ] : String( value );
		}
		case 'multiselect':
			return ( value || [] ).join( ', ' );
		case 'ref': {
			const opts = ( refs && refs[ field.ref ] ) || [];
			const hit = opts.find( ( o ) => o.id === value );
			return hit ? hit.name : '(borttagen)';
		}
		default:
			return String( value );
	}
}

export function FieldInput( { field, value, onChange, refs } ) {
	const id = 'nbs-f-' + field.key;
	const common = { id, name: field.key };
	let input;
	switch ( field.type ) {
		case 'textarea':
			input = <textarea { ...common } rows={ 3 } value={ value || '' } onChange={ ( e ) => onChange( e.target.value ) } />;
			break;
		case 'number':
			input = (
				<div className="nbs-input-unit">
					{ /* Text i stället för type=number så att decimalkomma (12,5) fungerar; servern validerar. */ }
					<input { ...common } type="text" inputMode="decimal" pattern="-?[0-9]*([.,][0-9]+)?" value={ value === undefined || value === null ? '' : String( value ).replace( '.', ',' ) } onChange={ ( e ) => onChange( e.target.value ) } />
					{ field.unit && <span>{ field.unit }</span> }
				</div>
			);
			break;
		case 'select':
			input = (
				<select { ...common } value={ value || '' } onChange={ ( e ) => onChange( e.target.value ) }>
					{ ! field.noEmpty && <option value="">– Välj –</option> }
					{ ( field.options || [] ).map( opt ).map( ( [ v, l ] ) => <option key={ v } value={ v }>{ l }</option> ) }
				</select>
			);
			break;
		case 'multiselect':
			input = (
				<div className="nbs-checks" id={ id }>
					{ ( field.options || [] ).map( ( o ) => {
						const on = ( value || [] ).includes( o );
						return (
							<label key={ o } className={ `nbs-check-pill${ on ? ' is-on' : '' }` }>
								<input type="checkbox" checked={ on } onChange={ () => onChange( on ? value.filter( ( x ) => x !== o ) : [ ...( value || [] ), o ] ) } />
								{ o }
							</label>
						);
					} ) }
				</div>
			);
			break;
		case 'bool':
			input = (
				<label className="nbs-switch">
					<input { ...common } type="checkbox" checked={ !! value } onChange={ ( e ) => onChange( e.target.checked ) } />
					<span>{ value ? 'Ja' : 'Nej' }</span>
				</label>
			);
			break;
		case 'date':
			input = <input { ...common } type="date" value={ value || '' } onChange={ ( e ) => onChange( e.target.value ) } />;
			break;
		case 'ref': {
			const opts = ( refs && refs[ field.ref ] ) || [];
			input = (
				<select { ...common } value={ value || '' } onChange={ ( e ) => onChange( e.target.value ) }>
					<option value="">– Välj –</option>
					{ opts.filter( ( o ) => o.active || o.id === value ).map( ( o ) => <option key={ o.id } value={ o.id }>{ o.name }</option> ) }
				</select>
			);
			if ( ! opts.length ) {
				input = <>{ input }<small className="nbs-help">Listan som fältet pekar på är tom.</small></>;
			}
			break;
		}
		case 'color':
			input = <input { ...common } type="color" value={ value || '#D99A2B' } onChange={ ( e ) => onChange( e.target.value ) } />;
			break;
		case 'url':
			input = <input { ...common } type="url" value={ value || '' } onChange={ ( e ) => onChange( e.target.value ) } placeholder="https://" />;
			break;
		default:
			input = <input { ...common } type="text" value={ value || '' } onChange={ ( e ) => onChange( e.target.value ) } />;
	}
	return (
		<div className="nbs-field">
			<label htmlFor={ id }>{ field.label }{ field.required && <span className="nbs-req" aria-label="obligatoriskt"> *</span> }</label>
			{ input }
			{ field.help && <small className="nbs-help">{ field.help }</small> }
		</div>
	);
}
