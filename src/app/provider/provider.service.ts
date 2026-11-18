import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

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
    return this.http.get(url, { params }).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === 0) {
          return throwError(() => new Error('CORS blocked: use localhost provider for development'));
        }
        return throwError(() => new Error(`Create failed: ${error.message}`));
      })
    );
  }

  lookupShortUrl(providerUrl: string, shortUrl: string): Observable<any> {
    const params = new HttpParams().set('shorturl', shortUrl);
    const url = `${providerUrl}/forward.php`;
    return this.http.get(url, { params }).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === 0) {
          return throwError(() => new Error('CORS blocked: use localhost provider for development'));
        }
        if (error.status === 404) {
          return throwError(() => new Error('Profile not found'));
        }
        return throwError(() => new Error(`Lookup failed: ${error.message}`));
      })
    );
  }
}
