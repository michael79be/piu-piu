import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ProviderService {
  constructor(private http: HttpClient) {}

  /**
   * Calls the URL shortener service.
   * @param providerUrl Base URL of the shortening service (e.g., https://is.gd)
   * @param base The long URL to encode
   * @param short Optional desired short code (without domain). If omitted, the service generates one.
   */
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
}
