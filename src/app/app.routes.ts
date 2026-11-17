import { Routes } from '@angular/router';
import { Register } from './register/register';
import { Profile } from './profile/profile';

export const routes: Routes = [{ path: '', component: Profile }, { path: 'register', component: Register }];
