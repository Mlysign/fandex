// `/{type}/{slug}`: a title's public address, the one the website's static
// pages are written to and the one Share hands out. The screen is the item
// screen; it reads `type` and `slug` where the app's own route gives it `id`.
//
// A static page exists for every title in the pool, so the app renders this
// route in two cases: it took over from that static page, or the title is too
// new to have one yet and the Worker answers for it.

export { default } from '../item/[id]';
