import {createApplication} from '../server.mjs';
import {memoryStore} from './memory-store.mjs';
import {fixture} from './fixture.mjs';
const app=await createApplication({store:memoryStore(fixture()),password:'test-password-12345'});
app.server.listen(3101,'127.0.0.1');
