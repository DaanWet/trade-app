import { Component, effect, input, output, signal, untracked } from '@angular/core';
import { parseDecimalInput } from '../../utils/format';

/**
 * Numeriek invoerveld dat zowel '.' als ',' als decimaalteken accepteert.
 * Praat in getallen naar buiten (value in / valueChange uit) en houdt intern
 * de rauwe getypte tekst bij, zodat het veld tijdens het typen niet terugspringt.
 */
@Component({
  selector: 'app-decimal-input',
  standalone: true,
  host: { class: 'd-block' }, // zodat de ingebedde .form-control de volle breedte krijgt
  template: `
    <input type="text" inputmode="decimal" class="form-control"
           [value]="text()"
           (input)="onInput($any($event.target).value)" />
  `,
})
export class DecimalInputComponent {
  /** Numerieke waarde (source-of-truth bij de parent). */
  value = input<number>(0);
  valueChange = output<number>();

  /** Rauwe tekst die de gebruiker ziet/typt — voorkomt snap-back. */
  protected text = signal('0');

  constructor() {
    // Sync een EXTERN gewijzigde waarde naar de tekst, maar niet terwijl de
    // gebruiker typt: alleen herschrijven als de binnenkomende waarde echt
    // verschilt van wat de huidige tekst voorstelt. `untracked` houdt de effect-
    // dependency beperkt tot value() en voorkomt een schrijf-lus op text.
    effect(() => {
      const incoming = this.value();
      if (parseDecimalInput(untracked(this.text)) !== incoming) {
        this.text.set(String(incoming));
      }
    });
  }

  onInput(raw: string): void {
    this.text.set(raw);                            // toon exact wat getypt is
    this.valueChange.emit(parseDecimalInput(raw)); // geef geparset getal door
  }
}
