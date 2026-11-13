// Tokenizer and recursive-descent parser. Port of TimeCalculatorParser in
// reference/complete_calculator_time.py, with the same grammar:
//
//   expr   = term (('+' | '-') term)*
//   term   = factor (('*' | '/' | '^') factor)*      left-assoc, one level
//   factor = atom ('|' atom)*                          '|' binds tightest
//   atom   = '(' expr ')' | literal [distop literal]
//
// Times (17:30, 5:30pm) and durations (15m, 2h30m) become minutes; times are
// minutes since midnight. Unlike the Python, whitespace separates tokens (it
// does not glue "5 3" into 53), "2h30" means 2h30m rather than silently 2h,
// and error positions point into the string as typed.
//
// Every node also gets a result kind (see combine), which decides how the
// answer is shown. The Python has no such thing: any time or duration in the
// expression makes the whole result a clock time.

export class ParseError extends Error {
    constructor(message, pos, end = pos) {
        super(message);
        this.name = 'ParseError';
        this.pos = pos;
        this.end = end;
    }
}

export const DIST_OPS = { '~': 'uniform', '~~': 'normal', '<~': 'left', '~>': 'right' };
const OP_OF_SHAPE = Object.fromEntries(Object.entries(DIST_OPS).map(([op, s]) => [s, op]));

// Order matters: a time is tried before a duration, a duration before a number
// (so "15m" is never the number 15 followed by a stray "m"). "5pm" and ".5"
// are small extensions over the Python, which rejects both.
const LITERALS = [
    ['time', /\d{1,2}:\d{2}(?:\s*[ap]m)?|\d{1,2}\s*[ap]m/iy],
    ['duration', /\d+(?:\.\d+)?h(?:\d+(?:\.\d+)?m?|\s+\d+(?:\.\d+)?m)?|\d+(?:\.\d+)?m/iy],
    ['number', /\d+(?:\.\d*)?|\.\d+/y],
];
// Longest first, so "~~" is never read as two "~".
const OPERATORS = ['~~', '<~', '~>', '~', '|', '+', '-', '*', '/', '^', '(', ')'];

export function tokenize(src) {
    const tokens = [];
    let pos = 0;
    outer: while (pos < src.length) {
        if (/\s/.test(src[pos])) {
            pos++;
            continue;
        }
        for (const [type, re] of LITERALS) {
            re.lastIndex = pos;
            const m = re.exec(src);
            if (m) {
                tokens.push({ type, text: m[0], pos, end: pos + m[0].length });
                pos += m[0].length;
                continue outer;
            }
        }
        for (const op of OPERATORS) {
            if (src.startsWith(op, pos)) {
                tokens.push({ type: 'op', text: op, pos, end: pos + op.length });
                pos += op.length;
                continue outer;
            }
        }
        throw new ParseError(`Unexpected '${src[pos]}'`, pos, pos + 1);
    }
    return tokens;
}

// TimeValue.from_string: 24h, or 12h with am/pm. Returns minutes since midnight.
function timeMinutes(tok) {
    const s = tok.text.toLowerCase().replace(/\s+/g, '');
    const isPm = s.endsWith('pm');
    const isAm = s.endsWith('am');
    const [h, m = '0'] = s.replace(/[ap]m$/, '').split(':');
    let hours = Number(h);
    const minutes = Number(m);
    if (isPm && hours !== 12) hours += 12;
    else if (isAm && hours === 12) hours = 0;
    if (hours > 23) throw new ParseError(`Hours must be 0-23 in '${tok.text}'`, tok.pos, tok.end);
    if (minutes > 59) throw new ParseError(`Minutes must be 0-59 in '${tok.text}'`, tok.pos, tok.end);
    return hours * 60 + minutes;
}

// Duration.from_string, except a bare trailing number after "h" counts as minutes.
function durationMinutes(tok) {
    const s = tok.text.toLowerCase();
    const h = /(\d+(?:\.\d+)?)h/.exec(s);
    const m = /h\s*(\d+(?:\.\d+)?)m?$|^(\d+(?:\.\d+)?)m$/.exec(s);
    return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1] ?? m[2]) : 0);
}

// Result kinds. A time of day is a point on the clock and a duration is the
// distance between two points, so they combine like points and vectors:
// time - time is a duration, time ± duration is a time, duration / duration
// is a plain number, and time + time means nothing. Under + - ~ and |, a
// plain number next to a time or duration counts as minutes. Every value is
// minutes underneath either way; the kind only changes how it is shown.
const T = 'time';
const D = 'duration';
const N = 'number';

function combine(op, a, b, tok) {
    const fail = (message) => {
        throw new ParseError(message, tok.pos, tok.end);
    };
    switch (op) {
        case '+':
            if (a === T && b === T) fail("Can't add two times of day. For a duration, write e.g. 1h30m");
            if (a === T || b === T) return T;
            return a === D || b === D ? D : N;
        case '-':
            if (b === T) {
                if (a === T) return D;
                fail(`Can't subtract a time of day from a ${a === D ? 'duration' : 'number'}`);
            }
            if (a === T) return T;
            return a === D || b === D ? D : N;
        case '*':
        case '/': {
            const verb = op === '*' ? 'multiply' : 'divide';
            if (a === T || b === T) fail(`Can't ${verb} a time of day. Subtract first, e.g. (5pm - 9am) ${op} 2`);
            if (op === '*') {
                if (a === D && b === D) fail("Can't multiply two durations");
                return a === D || b === D ? D : N;
            }
            if (b === D) {
                if (a === D) return N;
                fail("Can't divide a number by a duration (try 60m / 15m)");
            }
            return a;
        }
        case '^':
            if (a !== N || b !== N) fail('Powers only work on plain numbers');
            return N;
    }
}

// The two ends of a range, and every side of '|', must be the same kind; a
// plain number takes the kind of the other side.
function unify(a, b, tok, where) {
    if (a === b || b === N) return a;
    if (a === N) return b;
    throw new ParseError(`Can't mix a time of day and a duration ${where}`, tok.pos, tok.end);
}

class Parser {
    constructor(src) {
        this.src = src;
        this.tokens = tokenize(src);
        this.i = 0;
    }

    peek() {
        return this.tokens[this.i];
    }

    isOp(text) {
        const t = this.peek();
        return t !== undefined && t.type === 'op' && t.text === text;
    }

    fail(message) {
        const t = this.peek();
        if (t) throw new ParseError(message, t.pos, t.end);
        throw new ParseError(message, this.src.length);
    }

    describeNext() {
        const t = this.peek();
        return t ? `'${t.text}'` : 'end of input';
    }

    // parse_time_or_number, returning { value, kind }. A sign is only accepted
    // in front of a plain number, as in the Python, where the sign lives
    // inside the number regex.
    literal(after) {
        const start = this.peek();
        let sign = 1;
        if (start && start.type === 'op' && (start.text === '-' || start.text === '+')) {
            const next = this.tokens[this.i + 1];
            if (next && next.type === 'number') {
                sign = start.text === '-' ? -1 : 1;
                this.i++;
            }
        }
        const t = this.peek();
        if (!t || t.type === 'op') {
            const where = after ? ` after '${after}'` : '';
            this.fail(`Expected a number, time or duration${where}, found ${this.describeNext()}`);
        }
        this.i++;
        if (t.type === 'time') return { value: timeMinutes(t), kind: T };
        if (t.type === 'duration') return { value: durationMinutes(t), kind: D };
        return { value: sign * Number(t.text), kind: N };
    }

    atom() {
        if (this.isOp('(')) {
            const open = this.peek();
            this.i++;
            const inner = this.expr();
            if (!this.isOp(')')) {
                if (this.peek()) this.fail(`Expected ')', found ${this.describeNext()}`);
                throw new ParseError("Missing ')'", open.pos, open.end);
            }
            this.i++;
            return inner;
        }
        const a = this.literal();
        const t = this.peek();
        if (t && t.type === 'op' && DIST_OPS[t.text]) {
            this.i++;
            const b = this.literal(t.text);
            const kind = unify(a.kind, b.kind, t, 'in a range');
            return { type: 'dist', shape: DIST_OPS[t.text], min: a.value, max: b.value, kind };
        }
        return { type: 'num', value: a.value, kind: a.kind };
    }

    factor() {
        const branches = [this.atom()];
        let kind = branches[0].kind;
        while (this.isOp('|')) {
            const bar = this.peek();
            this.i++;
            const next = this.atom();
            kind = unify(kind, next.kind, bar, "on either side of '|'");
            branches.push(next);
        }
        return branches.length === 1 ? branches[0] : { type: 'mix', branches, kind };
    }

    binary(next, ops) {
        let node = next();
        while (ops.some((op) => this.isOp(op))) {
            const tok = this.peek();
            this.i++;
            const right = next();
            const kind = combine(tok.text, node.kind, right.kind, tok);
            node = { type: 'bin', op: tok.text, left: node, right, kind };
        }
        return node;
    }

    term() {
        return this.binary(() => this.factor(), ['*', '/', '^']);
    }

    expr() {
        return this.binary(() => this.term(), ['+', '-']);
    }
}

// Returns { ast, kind, canonical }. kind is the root node's kind: 'time',
// 'duration' or 'number' (see combine). canonical is the token stream without
// whitespace, used to seed the RNG so that "10 ~ 20" and "10~20" give
// identical results.
export function parse(src) {
    const p = new Parser(src);
    if (p.tokens.length === 0) throw new ParseError('Empty expression', 0);
    const ast = p.expr();
    if (p.peek()) p.fail(`Unexpected ${p.describeNext()}`);
    const canonical = p.tokens.map((t) => t.text.toLowerCase().replace(/\s+/g, '')).join('');
    return { ast, kind: ast.kind, canonical };
}

export function isStochastic(node) {
    switch (node.type) {
        case 'num':
            return false;
        case 'bin':
            return isStochastic(node.left) || isStochastic(node.right);
        default:
            return true;
    }
}

// Python's float repr, close enough for the values a parser produces.
function pyFloat(x) {
    return Number.isInteger(x) && Math.abs(x) < 1e16 ? `${x}.0` : String(x);
}

// Mirrors the Python AST __repr__s, so parse trees can be compared directly.
export function repr(node) {
    switch (node.type) {
        case 'num':
            return pyFloat(node.value);
        case 'dist':
            return `${pyFloat(node.min)}${OP_OF_SHAPE[node.shape]}${pyFloat(node.max)}`;
        case 'mix':
            return '(' + node.branches.map(repr).join(' | ') + ')';
        case 'bin':
            return `(${repr(node.left)} ${node.op} ${repr(node.right)})`;
    }
}
