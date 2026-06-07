import { HttpClient } from '@angular/common/http';
import { Component, signal } from '@angular/core';

type HelloResponse = {
  message: string;
};

type MatchResponse = {
  id: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  date: string;
};

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly hello = signal('Loading API greeting...');
  protected readonly matches = signal<MatchResponse[]>([]);
  protected readonly hasAccess = signal(false);
  protected readonly isCheckingAccess = signal(true);

  constructor(http: HttpClient) {
    const passkey = window.location.pathname.split('/').filter(Boolean)[0];

    if (!passkey) {
      this.isCheckingAccess.set(false);
      return;
    }

    http.get(`/api/access/${passkey}`).subscribe({
      next: () => {
        this.hasAccess.set(true);
        this.isCheckingAccess.set(false);

        this.loadHomePage(http);
      },
      error: () => {
        this.isCheckingAccess.set(false);
      }
    });
  }

  private loadHomePage(http: HttpClient) {
    http.get<HelloResponse>('/api/hello').subscribe((response) => {
      this.hello.set(response.message);
    });

    http.get<MatchResponse[]>('/api/matches').subscribe((response) => {
      this.matches.set(response);
    });
  }
}
