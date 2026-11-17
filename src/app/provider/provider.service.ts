import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ProviderService {
  constructor(private http: HttpClient) {}

  createShortUrl(providerUrl: string, base: string, short?: string): Observable<any> {
    let params = new HttpParams()
      .set('format', 'json')
      .set('url', base);
    if (short) {
      params = params.set('shorturl', short);
    }
    const url = `${providerUrl}/create.php`;
    return this.http.get(url, { params });
  }

  lookupShortUrl(providerUrl: string, shortUrl: string): Observable<any> {
    const params = new HttpParams().set('shorturl', shortUrl);
    const url = `${providerUrl}/lookup`;
    return this.http.get(url, { params });
  }
}
