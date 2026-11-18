import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, from } from 'rxjs';
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
    // First try with format=json (required by forward.php)
    const params = new HttpParams()
      .set('format', 'json')
      .set('shorturl', shortUrl);
    const url = `${providerUrl}/forward.php`;
    
    return this.http.get(url, { params }).pipe(
      catchError((error: HttpErrorResponse) => {
        // If CORS blocked, fall back to JSONP
        if (error.status === 0) {
          return this.lookupShortUrlJsonp(providerUrl, shortUrl);
        }
        if (error.status === 404) {
          return throwError(() => new Error('Profile not found'));
        }
        return throwError(() => new Error(`Lookup failed: ${error.message}`));
      })
    );
  }

  private lookupShortUrlJsonp(providerUrl: string, shortUrl: string): Observable<any> {
    return from(new Promise<any>((resolve, reject) => {
      const callbackName = `getFullUrl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const url = `${providerUrl}/forward.php?shorturl=${encodeURIComponent(shortUrl)}&format=json&callback=${callbackName}`;
      
      (window as any)[callbackName] = (data: any) => {
        delete (window as any)[callbackName];
        const script = document.getElementById(callbackName);
        if (script) script.remove();
        
        if (data && data.url) {
          resolve({ url: data.url });
        } else {
          reject(new Error('Profile not found'));
        }
      };
      
      const script = document.createElement('script');
      script.id = callbackName;
      script.src = url;
      script.onerror = () => {
        delete (window as any)[callbackName];
        script.remove();
        reject(new Error('Lookup failed: JSONP request failed'));
      };
      document.head.appendChild(script);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        if ((window as any)[callbackName]) {
          delete (window as any)[callbackName];
          const s = document.getElementById(callbackName);
          if (s) s.remove();
          reject(new Error('Lookup timeout'));
        }
      }, 10000);
    }));
  }
}
