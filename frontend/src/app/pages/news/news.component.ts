import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { NewsBadgeService } from '../../services/news-badge.service';
import { TickerSearchComponent } from '../../shared/ticker-search/ticker-search.component';
import { chipCounts, filterArticles, topicKey } from '../../utils/news-filter';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import type {
  NewsArticle,
  NewsResponse,
  NewsTopic,
  NewsTopicKind,
  NewsTopicOrigin,
  NewsTopicRef,
} from '../../models';

const ORIGIN_ICONS: Record<NewsTopicOrigin, string> = {
  POSITION: 'bi-briefcase',
  WATCHLIST: 'bi-eye',
  KEYWORD: 'bi-search',
};

@Component({
  selector: 'app-news',
  standalone: true,
  imports: [TickerSearchComponent],
  templateUrl: './news.component.html',
})
export class NewsComponent implements OnInit {
  private api = inject(ApiService);
  private badge = inject(NewsBadgeService);

  /**
   * Artikels die tijdens dit bezoek als nieuw binnenkwamen. De server markeert ze meteen als
   * gezien, dus na ⟳ zou hun label anders verdwijnen; zo blijft het tot je de tab verlaat.
   */
  private visitNew = new Set<string>();

  data = signal<NewsResponse | null>(null);
  filter = signal<NewsTopicRef | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  error = signal<string | null>(null);

  showAdd = signal(false);
  addKind = signal<NewsTopicKind>('TICKER');
  keyword = signal('');
  adding = signal(false);
  addError = signal<string | null>(null);

  readonly articles = computed(() => filterArticles(this.data()?.articles ?? [], this.filter()));
  readonly counts = computed(() => chipCounts(this.data()?.articles ?? [], this.data()?.topics ?? []));
  readonly failedLabel = computed(() =>
    (this.data()?.status.failed_topics ?? []).map(t => t.value).join(', '),
  );

  readonly topicKey = topicKey;
  readonly formatRelativeTime = formatRelativeTime;
  readonly formatDateTime = formatDateTime;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.api.getNews().subscribe({
      next: r => this.show(r),
      error: err => {
        this.loading.set(false);
        this.error.set(err?.error?.error ?? 'Nieuws ophalen mislukt');
      },
    });
  }

  /** Geforceerde ronde; sluit aan bij een ronde die al loopt. */
  refresh(): void {
    this.refreshing.set(true);
    this.api.refreshNews().subscribe({
      next: r => {
        this.refreshing.set(false);
        this.show(r);
      },
      error: err => {
        this.refreshing.set(false);
        this.error.set(err?.error?.error ?? 'Vernieuwen mislukt');
      },
    });
  }

  isNew(a: NewsArticle): boolean {
    return a.is_new || this.visitNew.has(a.id);
  }

  isActive(t: NewsTopicRef): boolean {
    const f = this.filter();
    return f != null && topicKey(f) === topicKey(t);
  }

  originIcon(origin: NewsTopicOrigin): string {
    return ORIGIN_ICONS[origin];
  }

  addTopic(kind: NewsTopicKind, value: string): void {
    const v = value.trim();
    if (!v || this.adding()) return;
    this.adding.set(true);
    this.addError.set(null);
    this.api.addNewsTopic({ kind, value: v }).subscribe({
      next: () => {
        this.adding.set(false);
        this.showAdd.set(false);
        this.keyword.set('');
        this.load();
      },
      error: err => {
        this.adding.set(false);
        this.addError.set(err?.error?.error ?? 'Volgen mislukt');
      },
    });
  }

  removeTopic(t: NewsTopic): void {
    if (t.id == null) return;
    this.api.deleteNewsTopic(t.id).subscribe({
      next: () => this.load(),
      error: err => this.error.set(err?.error?.error ?? 'Verwijderen mislukt'),
    });
  }

  /** Toon een antwoord en meld het als gezien; de badge gaat dan naar 0. */
  private show(r: NewsResponse): void {
    for (const a of r.articles) if (a.is_new) this.visitNew.add(a.id);
    const f = this.filter();
    if (f && !r.topics.some(t => topicKey(t) === topicKey(f))) this.filter.set(null);
    this.data.set(r);
    this.loading.set(false);
    this.error.set(null);
    this.api.markNewsSeen(r.as_of).subscribe({ next: () => this.badge.clear(), error: () => {} });
    // Loopt er al een achtergrondronde (bv. net na het opstarten van de app)? Sluit erbij aan,
    // anders blijft de lijst leeg tot je zelf vernieuwt.
    if (r.status.refreshing && !this.refreshing()) this.refresh();
  }
}
