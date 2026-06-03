import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'];

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './settings.component.html',
})
export class SettingsComponent implements OnInit {
  private api = inject(ApiService);

  displayCurrency = signal<string>('EUR');
  saving = signal(false);
  message = signal<string | null>(null);

  readonly currencies = CURRENCIES;

  ngOnInit(): void {
    this.api.getSettings().subscribe(s => {
      if (s['display_currency']) this.displayCurrency.set(s['display_currency']);
    });
  }

  save(): void {
    this.saving.set(true);
    this.message.set(null);
    this.api.updateSettings({ display_currency: this.displayCurrency() }).subscribe({
      next: () => {
        this.saving.set(false);
        this.message.set('Opgeslagen.');
      },
      error: err => {
        this.saving.set(false);
        this.message.set(err?.error?.error ?? 'Opslaan mislukt');
      },
    });
  }
}
