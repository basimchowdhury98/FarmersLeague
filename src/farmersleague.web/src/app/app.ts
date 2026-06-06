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

  constructor(http: HttpClient) {
    http.get<HelloResponse>('/api/hello').subscribe((response) => {
      this.hello.set(response.message);
    });

    http.get<MatchResponse[]>('/api/matches').subscribe((response) => {
      this.matches.set(response);
    });
  }
}
