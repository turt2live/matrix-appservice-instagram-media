import { RouterModule, Routes } from "@angular/router";
import { HomeComponent } from "./home/home.component";
import { AuthComponent } from "./auth/auth.component";

const routes: Routes = [
    {path: '', component: HomeComponent},
    {path: 'auth/:status', component: AuthComponent}
];

export const routing = RouterModule.forRoot(routes);
