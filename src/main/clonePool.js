/** Reuses simulation objects; search cost is dominated by allocation. */
export class ClonePool {
  constructor(construct) {
    this.construct = construct;
    this.free = [];
    this.created = 0;
    this.outstanding = 0;
  }

  acquire() {
    this.outstanding += 1;
    const obj = this.free.pop();
    if (obj) return obj;
    this.created += 1;
    return this.construct();
  }

  release(obj) {
    if (!obj) return;
    this.outstanding -= 1;
    this.free.push(obj);
  }
}
