import { Pipe, PipeTransform } from '@angular/core';
import { formatDate, formatMoney, formatNumber, formatPercent, formatShares } from '../../utils/format';

@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform {
  transform(value: number | null | undefined, currency: string, fractionDigits = 2): string {
    return formatMoney(value, currency, fractionDigits);
  }
}

@Pipe({ name: 'num', standalone: true })
export class NumberPipe implements PipeTransform {
  transform(value: number | null | undefined, fractionDigits = 2): string {
    return formatNumber(value, fractionDigits);
  }
}

@Pipe({ name: 'pct', standalone: true })
export class PercentPipe implements PipeTransform {
  transform(value: number | null | undefined, fractionDigits = 2): string {
    return formatPercent(value, fractionDigits);
  }
}

@Pipe({ name: 'shares', standalone: true })
export class SharesPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatShares(value);
  }
}

@Pipe({ name: 'd', standalone: true })
export class DatePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return formatDate(value);
  }
}
