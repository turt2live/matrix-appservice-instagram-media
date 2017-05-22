import { Component } from "@angular/core";
import { ActivatedRoute, Params } from "@angular/router";

@Component({
    selector: 'my-auth',
    templateUrl: './auth.component.html',
    styleUrls: ['./auth.component.scss'],
})
export class AuthComponent {

    public isSuccess = false;

    constructor(private route: ActivatedRoute) {
        this.route.params.subscribe((params: Params) => this.isSuccess = params['status'] === 'success');
    }

}
