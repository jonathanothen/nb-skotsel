import { uuid } from './api';
import { Button } from './ui';
import { FIELD_TYPES } from './fields';

/**
 * Redigerare för egna fält (etikett, typ, alternativ, koppling, enhet, hjälptext).
 * Används både för listor och för registren (bigård, samhälle, drottning, kupa).
 * Fälten har ett tillfälligt _id för React och optionsText medan alternativen skrivs.
 */
export const withIds = ( fields ) => ( fields || [] ).map( ( f ) => ( { ...f, _id: uuid() } ) );

export const cleanFields = ( fields ) =>
	fields.map( ( { _id, optionsText, ...f } ) => ( {
		...f,
		options: optionsText !== undefined ? optionsText.split( ',' ).map( ( s ) => s.trim() ).filter( Boolean ) : f.options,
	} ) );

/** Skötselkort: vad ett fält blir när besöket avslutas (styrka, bihälsopost för varroamodellen). */
export function mapOptions( f, treatments = [] ) {
	const none = [ '', 'Bara i besöket' ];
	if ( f.type === 'bool' ) {
		const active = treatments.filter( ( t ) => t.active !== false );
		return [
			none,
			...active.map( ( t ) => [ 'treat:' + t.id, 'Ikryssat: registrerar behandlingen ' + t.name ] ),
			...active.map( ( t ) => [ 'split:' + t.id, 'Ikryssat: delar av en avläggare som behandlas med ' + t.name ] ),
		];
	}
	if ( f.type === 'scale' ) {
		return [ none, [ 'strength', 'Uppdaterar samhällets styrka' ] ];
	}
	if ( f.type === 'number' ) {
		return [
			none,
			[ 'strength', 'Uppdaterar samhällets styrka' ],
			[ 'varroa:Naturligt nedfall', 'Varroamätning: naturligt nedfall (kvalster/dygn)' ],
			[ 'varroa:Alkoholtvätt', 'Varroamätning: alkoholtvätt (% av bina)' ],
			[ 'varroa:Sockerrullning', 'Varroamätning: sockerrullning (% av bina)' ],
			[ 'varroa:Drönaryngel', 'Varroamätning: drönaryngel (% angripna celler)' ],
			[ 'kill', 'Behandlingens avdödning (%)' ],
		];
	}
	if ( f.type === 'ref' && f.ref === 'behandling' ) {
		return [ none, [ 'treatment', 'Registrerar en behandling i Bihälsa' ] ];
	}
	return [ none ];
}

export default function FieldDefs( { fields, setFields, refLists, allowMaps, treatments } ) {
	const upd = ( i, patch ) => setFields( ( fs ) => fs.map( ( f, j ) => ( j === i ? { ...f, ...patch } : f ) ) );
	const move = ( i, d ) =>
		setFields( ( fs ) => {
			const a = [ ...fs ];
			const j = i + d;
			if ( j < 0 || j >= a.length ) {
				return a;
			}
			[ a[ i ], a[ j ] ] = [ a[ j ], a[ i ] ];
			return a;
		} );

	return (
		<>
			{ fields.map( ( f, i ) => (
				<div className="nbs-field-def" key={ f._id }>
					<div className="nbs-form-row">
						<div className="nbs-field">
							<label>Etikett</label>
							<input type="text" value={ f.label } onChange={ ( e ) => upd( i, { label: e.target.value } ) } placeholder="T.ex. Pris" />
						</div>
						<div className="nbs-field">
							<label>Typ</label>
							<select value={ f.type } onChange={ ( e ) => upd( i, { type: e.target.value } ) }>
								{ FIELD_TYPES.map( ( [ k, l ] ) => <option key={ k } value={ k }>{ l }</option> ) }
							</select>
						</div>
					</div>
					{ ( f.type === 'select' || f.type === 'multiselect' ) && (
						<div className="nbs-field">
							<label>Alternativ (separera med komma)</label>
							<input type="text" value={ f.optionsText !== undefined ? f.optionsText : ( f.options || [] ).join( ', ' ) } onChange={ ( e ) => upd( i, { optionsText: e.target.value } ) } placeholder="Liten, Mellan, Stor" />
						</div>
					) }
					{ f.type === 'ref' && (
						<div className="nbs-field">
							<label>Kopplas till listan</label>
							<select value={ f.ref || '' } onChange={ ( e ) => upd( i, { ref: e.target.value } ) }>
								<option value="">– Välj lista –</option>
								{ refLists.map( ( l ) => <option key={ l.id } value={ l.key }>{ l.name }</option> ) }
							</select>
						</div>
					) }
					{ f.type === 'scale' && (
						<div className="nbs-form-row">
							<div className="nbs-field"><label>Från</label><input type="number" min="0" max="9" value={ f.min ?? 1 } onChange={ ( e ) => upd( i, { min: e.target.value } ) } /></div>
							<div className="nbs-field"><label>Till</label><input type="number" min="1" max="10" value={ f.max ?? 5 } onChange={ ( e ) => upd( i, { max: e.target.value } ) } /></div>
						</div>
					) }
					{ allowMaps && mapOptions( f, treatments ).length > 1 && (
						<div className="nbs-field">
							<label htmlFor={ `nbs-fd-maps-${ i }` }>När besöket avslutas</label>
							<select id={ `nbs-fd-maps-${ i }` } value={ f.maps || '' } onChange={ ( e ) => upd( i, { maps: e.target.value } ) }>
								{ mapOptions( f, treatments ).map( ( [ v, l ] ) => <option key={ v } value={ v }>{ l }</option> ) }
							</select>
						</div>
					) }
					{ f.type === 'number' && (
						<div className="nbs-form-row">
							<div className="nbs-field"><label>Enhet</label><input type="text" value={ f.unit || '' } onChange={ ( e ) => upd( i, { unit: e.target.value } ) } placeholder="kg, kr, %" /></div>
							<div className="nbs-field"><label>Min</label><input type="number" value={ f.min ?? '' } onChange={ ( e ) => upd( i, { min: e.target.value } ) } /></div>
							<div className="nbs-field"><label>Max</label><input type="number" value={ f.max ?? '' } onChange={ ( e ) => upd( i, { max: e.target.value } ) } /></div>
						</div>
					) }
					<div className="nbs-field">
						<label>Hjälptext</label>
						<input type="text" value={ f.help || '' } onChange={ ( e ) => upd( i, { help: e.target.value } ) } />
					</div>
					<div className="nbs-field-def-actions">
						<label className="nbs-inline-check"><input type="checkbox" checked={ !! f.required } onChange={ ( e ) => upd( i, { required: e.target.checked } ) } /> Obligatoriskt</label>
						<span className="nbs-spacer" />
						<button type="button" className="nbs-icon-btn" onClick={ () => move( i, -1 ) } disabled={ i === 0 } aria-label="Flytta upp">↑</button>
						<button type="button" className="nbs-icon-btn" onClick={ () => move( i, 1 ) } disabled={ i === fields.length - 1 } aria-label="Flytta ned">↓</button>
						<Button variant="danger-link" small onClick={ () => setFields( ( fs ) => fs.filter( ( _, j ) => j !== i ) ) }>Ta bort fält</Button>
					</div>
				</div>
			) ) }
			<Button variant="ghost" onClick={ () => setFields( ( fs ) => [ ...fs, { _id: uuid(), label: '', type: 'text' } ] ) }>+ Lägg till fält</Button>
		</>
	);
}
