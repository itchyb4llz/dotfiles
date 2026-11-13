// @ts-nocheck
// @leeoniya/ufuzzy 1.0.19, bundled by scripts/vendor.sh: don't edit.
var cmp = (a, b) => a > b ? 1 : a < b ? -1 : 0;
var inf = Infinity;
var escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var EXACT_HERE = "eexxaacctt";
var PUNCT_RE = /\p{P}/gu;
var LATIN_UPPER = "A-Z";
var LATIN_LOWER = "a-z";
var COLLATE_ARGS = ["en", { numeric: true, sensitivity: "base" }];
var swapAlpha = (str, upper, lower) => str.replace(LATIN_UPPER, upper).replace(LATIN_LOWER, lower);
var OPTS = {
  unicode: false,
  alpha: null,
  interSplit: "[^A-Za-z\\d']+",
  intraSplit: "[a-z][A-Z]",
  interBound: "[^A-Za-z\\d]",
  intraBound: "[A-Za-z]\\d|\\d[A-Za-z]|[a-z][A-Z]",
  interLft: 0,
  interRgt: 0,
  interChars: ".",
  interIns: inf,
  intraChars: "[a-z\\d']",
  intraIns: null,
  intraContr: "'[a-z]{1,2}\\b",
  intraMode: 0,
  intraSlice: [1, inf],
  intraSub: null,
  intraTrn: null,
  intraDel: null,
  intraFilt: (term, match, index) => true,
  toUpper: (str) => str.toLocaleUpperCase(),
  toLower: (str) => str.toLocaleLowerCase(),
  compare: null,
  sort: (info, haystack, needle, compare = cmp) => {
    let {
      idx,
      chars,
      terms,
      interLft2,
      interLft1,
      start,
      intraIns,
      interIns,
      cases
    } = info;
    return idx.map((v, i) => i).sort((ia, ib) => chars[ib] - chars[ia] || intraIns[ia] - intraIns[ib] || terms[ib] + interLft2[ib] + 0.5 * interLft1[ib] - (terms[ia] + interLft2[ia] + 0.5 * interLft1[ia]) || interIns[ia] - interIns[ib] || start[ia] - start[ib] || cases[ib] - cases[ia] || compare(haystack[idx[ia]], haystack[idx[ib]]));
  }
};
var lazyRepeat = (chars, limit) => limit == 0 ? "" : limit == 1 ? chars + "??" : limit == inf ? chars + "*?" : chars + `{0,${limit}}?`;
var mode2Tpl = "(?:\\b|_)";
function uFuzzy(opts) {
  opts = Object.assign({}, OPTS, opts);
  let {
    unicode,
    interLft,
    interRgt,
    intraMode,
    intraSlice,
    intraIns,
    intraSub,
    intraTrn,
    intraDel,
    intraContr,
    intraSplit: _intraSplit,
    interSplit: _interSplit,
    intraBound: _intraBound,
    interBound: _interBound,
    intraChars,
    toUpper,
    toLower,
    compare
  } = opts;
  intraIns ??= intraMode;
  intraSub ??= intraMode;
  intraTrn ??= intraMode;
  intraDel ??= intraMode;
  compare ??= typeof Intl == "undefined" ? cmp : new Intl.Collator(...COLLATE_ARGS).compare;
  let alpha = opts.letters ?? opts.alpha;
  if (alpha != null) {
    let upper = toUpper(alpha);
    let lower = toLower(alpha);
    _interSplit = swapAlpha(_interSplit, upper, lower);
    _intraSplit = swapAlpha(_intraSplit, upper, lower);
    _interBound = swapAlpha(_interBound, upper, lower);
    _intraBound = swapAlpha(_intraBound, upper, lower);
    intraChars = swapAlpha(intraChars, upper, lower);
    intraContr = swapAlpha(intraContr, upper, lower);
  }
  let uFlag = unicode ? "u" : "";
  const quotedAny = '".+?"';
  const EXACTS_RE = new RegExp(quotedAny, "gi" + uFlag);
  const NEGS_RE = new RegExp(`(?:\\s+|^)-(?:${intraChars}+|${quotedAny})`, "gi" + uFlag);
  let { intraRules } = opts;
  if (intraRules == null) {
    intraRules = (p) => {
      let _intraSlice = OPTS.intraSlice, _intraIns = 0, _intraSub = 0, _intraTrn = 0, _intraDel = 0;
      if (/[^\d]/.test(p)) {
        let plen = p.length;
        if (plen <= 4) {
          if (plen >= 3) {
            _intraTrn = Math.min(intraTrn, 1);
            if (plen == 4)
              _intraIns = Math.min(intraIns, 1);
          }
        } else {
          _intraSlice = intraSlice;
          _intraIns = intraIns, _intraSub = intraSub, _intraTrn = intraTrn, _intraDel = intraDel;
        }
      }
      return {
        intraSlice: _intraSlice,
        intraIns: _intraIns,
        intraSub: _intraSub,
        intraTrn: _intraTrn,
        intraDel: _intraDel
      };
    };
  }
  let withIntraSplit = !!_intraSplit;
  let intraSplit = new RegExp(_intraSplit, "g" + uFlag);
  let interSplit = new RegExp(_interSplit, "g" + uFlag);
  let trimRe = new RegExp("^" + _interSplit + "|" + _interSplit + "$", "g" + uFlag);
  let contrsRe = new RegExp(intraContr, "gi" + uFlag);
  const split = (needle, keepCase = false) => {
    let exacts = [];
    needle = needle.replace(EXACTS_RE, (m) => {
      exacts.push(m);
      return EXACT_HERE;
    });
    needle = needle.replace(trimRe, "");
    if (!keepCase)
      needle = toLower(needle);
    if (withIntraSplit)
      needle = needle.replace(intraSplit, (m) => m[0] + " " + m[1]);
    let j = 0;
    return needle.split(interSplit).filter((t) => t != "").map((v) => v === EXACT_HERE ? exacts[j++] : v);
  };
  const NUM_OR_ALPHA_RE = /[^\d]+|\d+/g;
  const prepQuery = (needle, capt = 0, interOR = false) => {
    let parts = split(needle);
    if (parts.length == 0)
      return [];
    let contrs = Array(parts.length).fill("");
    parts = parts.map((p, pi) => p.replace(contrsRe, (m) => {
      contrs[pi] = m;
      return "";
    }));
    let reTpl;
    if (intraMode == 1) {
      reTpl = parts.map((p, pi) => {
        if (p[0] === '"')
          return escapeRegExp(p.slice(1, -1));
        let reTpl = "";
        for (let m of p.matchAll(NUM_OR_ALPHA_RE)) {
          let p = m[0];
          let {
            intraSlice,
            intraIns,
            intraSub,
            intraTrn,
            intraDel
          } = intraRules(p);
          if (intraIns + intraSub + intraTrn + intraDel == 0)
            reTpl += p + contrs[pi];
          else {
            let [lftIdx, rgtIdx] = intraSlice;
            let lftChar = p.slice(0, lftIdx);
            let rgtChar = p.slice(rgtIdx);
            let chars = p.slice(lftIdx, rgtIdx);
            if (intraIns == 1 && lftChar.length == 1 && lftChar != chars[0])
              lftChar += "(?!" + lftChar + ")";
            let numChars = chars.length;
            let variants = [p];
            if (intraSub) {
              for (let i = 0;i < numChars; i++)
                variants.push(lftChar + chars.slice(0, i) + intraChars + chars.slice(i + 1) + rgtChar);
            }
            if (intraTrn) {
              for (let i = 0;i < numChars - 1; i++) {
                if (chars[i] != chars[i + 1])
                  variants.push(lftChar + chars.slice(0, i) + chars[i + 1] + chars[i] + chars.slice(i + 2) + rgtChar);
              }
            }
            if (intraDel) {
              for (let i = 0;i < numChars; i++)
                variants.push(lftChar + chars.slice(0, i + 1) + "?" + chars.slice(i + 1) + rgtChar);
            }
            if (intraIns) {
              let intraInsTpl = lazyRepeat(intraChars, 1);
              for (let i = 0;i < numChars; i++)
                variants.push(lftChar + chars.slice(0, i) + intraInsTpl + chars.slice(i) + rgtChar);
            }
            reTpl += "(?:" + variants.join("|") + ")" + contrs[pi];
          }
        }
        return reTpl;
      });
    } else {
      let intraInsTpl = lazyRepeat(intraChars, intraIns);
      if (capt == 2 && intraIns > 0) {
        intraInsTpl = ")(" + intraInsTpl + ")(";
      }
      reTpl = parts.map((p, pi) => p[0] === '"' ? escapeRegExp(p.slice(1, -1)) : p.split("").map((c, i, chars) => {
        if (intraIns == 1 && i == 0 && chars.length > 1 && c != chars[i + 1])
          c += "(?!" + c + ")";
        return c;
      }).join(intraInsTpl) + contrs[pi]);
    }
    let preTpl = interLft == 2 ? mode2Tpl : "";
    let sufTpl = interRgt == 2 ? mode2Tpl : "";
    let interCharsTpl = sufTpl + lazyRepeat(opts.interChars, opts.interIns) + preTpl;
    if (capt > 0) {
      if (interOR) {
        reTpl = preTpl + "(" + reTpl.join(")" + sufTpl + "|" + preTpl + "(") + ")" + sufTpl;
      } else {
        reTpl = "(" + reTpl.join(")(" + interCharsTpl + ")(") + ")";
        reTpl = "(.??" + preTpl + ")" + reTpl + "(" + sufTpl + ".*)";
      }
    } else {
      reTpl = reTpl.join(interCharsTpl);
      reTpl = preTpl + reTpl + sufTpl;
    }
    return [new RegExp(reTpl, "i" + uFlag), parts, contrs];
  };
  const filter = (haystack, needle, idxs) => {
    let [query] = prepQuery(needle);
    if (query == null)
      return null;
    let out = [];
    if (idxs != null) {
      for (let i = 0;i < idxs.length; i++) {
        let idx = idxs[i];
        query.test(haystack[idx]) && out.push(idx);
      }
    } else {
      for (let i = 0;i < haystack.length; i++)
        query.test(haystack[i]) && out.push(i);
    }
    return out;
  };
  let withIntraBound = !!_intraBound;
  let interBound = new RegExp(_interBound, uFlag);
  let intraBound = new RegExp(_intraBound, uFlag);
  const info = (idxs, haystack, needle) => {
    let [query, parts, contrs] = prepQuery(needle, 1);
    let partsCased = split(needle, true);
    let [queryR] = prepQuery(needle, 2);
    let partsLen = parts.length;
    let _terms = Array(partsLen);
    let _termsCased = Array(partsLen);
    for (let j = 0;j < partsLen; j++) {
      let part = parts[j];
      let partCased = partsCased[j];
      let term = part[0] == '"' ? part.slice(1, -1) : part + contrs[j];
      let termCased = partCased[0] == '"' ? partCased.slice(1, -1) : partCased + contrs[j];
      _terms[j] = term;
      _termsCased[j] = termCased;
    }
    let len = idxs.length;
    let field = Array(len).fill(0);
    let info = {
      idx: Array(len),
      start: field.slice(),
      chars: field.slice(),
      cases: field.slice(),
      terms: field.slice(),
      interIns: field.slice(),
      intraIns: field.slice(),
      interLft2: field.slice(),
      interRgt2: field.slice(),
      interLft1: field.slice(),
      interRgt1: field.slice(),
      ranges: Array(len)
    };
    let mayDiscard = interLft == 1 || interRgt == 1;
    let ii = 0;
    for (let i = 0;i < idxs.length; i++) {
      let mhstr = haystack[idxs[i]];
      let m = mhstr.match(query);
      let start = m.index + m[1].length;
      let idxAcc = start;
      let disc = false;
      let lft2 = 0;
      let lft1 = 0;
      let rgt2 = 0;
      let rgt1 = 0;
      let chars = 0;
      let terms = 0;
      let cases = 0;
      let inter = 0;
      let intra = 0;
      let refine = [];
      for (let j = 0, k = 2;j < partsLen; j++, k += 2) {
        let group = toLower(m[k]);
        let term = _terms[j];
        let termCased = _termsCased[j];
        let termLen = term.length;
        let groupLen = group.length;
        let fullMatch = group == term;
        if (m[k] == termCased)
          cases++;
        if (!fullMatch && m[k + 1].length >= termLen) {
          let idxOf = toLower(m[k + 1]).indexOf(term);
          if (idxOf > -1) {
            refine.push(idxAcc, groupLen, idxOf, termLen);
            idxAcc += refineMatch(m, k, idxOf, termLen);
            group = term;
            groupLen = termLen;
            fullMatch = true;
            if (j == 0)
              start = idxAcc;
          }
        }
        if (mayDiscard || fullMatch) {
          let lftCharIdx = idxAcc - 1;
          let rgtCharIdx = idxAcc + groupLen;
          let isPre = false;
          let isSuf = false;
          if (lftCharIdx == -1 || interBound.test(mhstr[lftCharIdx])) {
            fullMatch && lft2++;
            isPre = true;
          } else {
            if (interLft == 2) {
              disc = true;
              break;
            }
            if (withIntraBound && intraBound.test(mhstr[lftCharIdx] + mhstr[lftCharIdx + 1])) {
              fullMatch && lft1++;
              isPre = true;
            } else {
              if (interLft == 1) {
                let junk = m[k + 1];
                let junkIdx = idxAcc + groupLen;
                if (junk.length >= termLen) {
                  let idxOf = 0;
                  let found = false;
                  let re = new RegExp(term, "ig" + uFlag);
                  let m2;
                  while (m2 = re.exec(junk)) {
                    idxOf = m2.index;
                    let charIdx = junkIdx + idxOf;
                    let lftCharIdx = charIdx - 1;
                    if (lftCharIdx == -1 || interBound.test(mhstr[lftCharIdx])) {
                      lft2++;
                      found = true;
                      break;
                    } else if (intraBound.test(mhstr[lftCharIdx] + mhstr[charIdx])) {
                      lft1++;
                      found = true;
                      break;
                    }
                  }
                  if (found) {
                    isPre = true;
                    refine.push(idxAcc, groupLen, idxOf, termLen);
                    idxAcc += refineMatch(m, k, idxOf, termLen);
                    group = term;
                    groupLen = termLen;
                    fullMatch = true;
                    if (j == 0)
                      start = idxAcc;
                  }
                }
                if (!isPre) {
                  disc = true;
                  break;
                }
              }
            }
          }
          if (rgtCharIdx == mhstr.length || interBound.test(mhstr[rgtCharIdx])) {
            fullMatch && rgt2++;
            isSuf = true;
          } else {
            if (interRgt == 2) {
              disc = true;
              break;
            }
            if (withIntraBound && intraBound.test(mhstr[rgtCharIdx - 1] + mhstr[rgtCharIdx])) {
              fullMatch && rgt1++;
              isSuf = true;
            } else {
              if (interRgt == 1) {
                disc = true;
                break;
              }
            }
          }
          if (fullMatch) {
            chars += termLen;
            if (isPre && isSuf)
              terms++;
          }
        }
        if (groupLen > termLen)
          intra += groupLen - termLen;
        if (j > 0)
          inter += m[k - 1].length;
        if (!opts.intraFilt(term, group, idxAcc)) {
          disc = true;
          break;
        }
        if (j < partsLen - 1)
          idxAcc += groupLen + m[k + 1].length;
      }
      if (!disc) {
        info.idx[ii] = idxs[i];
        info.interLft2[ii] = lft2;
        info.interLft1[ii] = lft1;
        info.interRgt2[ii] = rgt2;
        info.interRgt1[ii] = rgt1;
        info.chars[ii] = chars;
        info.terms[ii] = terms;
        info.cases[ii] = cases;
        info.interIns[ii] = inter;
        info.intraIns[ii] = intra;
        info.start[ii] = start;
        let m = mhstr.match(queryR);
        let idxAcc = m.index + m[1].length;
        let refLen = refine.length;
        let ri = refLen > 0 ? 0 : Infinity;
        let lastRi = refLen - 4;
        for (let i = 2;i < m.length; ) {
          let len = m[i].length;
          if (ri <= lastRi && refine[ri] == idxAcc) {
            let groupLen = refine[ri + 1];
            let idxOf = refine[ri + 2];
            let termLen = refine[ri + 3];
            let j = i;
            let v = "";
            for (let _len = 0;_len < groupLen; j++) {
              v += m[j];
              _len += m[j].length;
            }
            m.splice(i, j - i, v);
            idxAcc += refineMatch(m, i, idxOf, termLen);
            ri += 4;
          } else {
            idxAcc += len;
            i++;
          }
        }
        idxAcc = m.index + m[1].length;
        let ranges = info.ranges[ii] = [];
        let from = idxAcc;
        let to = idxAcc;
        for (let i = 2;i < m.length; i++) {
          let len = m[i].length;
          idxAcc += len;
          if (i % 2 == 0)
            to = idxAcc;
          else if (len > 0) {
            ranges.push(from, to);
            from = to = idxAcc;
          }
        }
        if (to > from)
          ranges.push(from, to);
        ii++;
      }
    }
    if (ii < idxs.length) {
      for (let k in info)
        info[k] = info[k].slice(0, ii);
    }
    return info;
  };
  const refineMatch = (m, k, idxInNext, termLen) => {
    let prepend = m[k] + m[k + 1].slice(0, idxInNext);
    m[k - 1] += prepend;
    m[k] = m[k + 1].slice(idxInNext, idxInNext + termLen);
    m[k + 1] = m[k + 1].slice(idxInNext + termLen);
    return prepend.length;
  };
  const OOO_TERMS_LIMIT = 5;
  const _search = (haystack, needle, outOfOrder, infoThresh = 1000, preFiltered) => {
    outOfOrder = !outOfOrder ? 0 : outOfOrder === true ? OOO_TERMS_LIMIT : outOfOrder;
    let needles = null;
    let matches = null;
    let negs = [];
    needle = needle.replace(NEGS_RE, (m) => {
      let neg = m.trim().slice(1);
      neg = neg[0] === '"' ? escapeRegExp(neg.slice(1, -1)) : neg.replace(PUNCT_RE, "");
      if (neg != "")
        negs.push(neg);
      return "";
    });
    let terms = split(needle);
    let negsRe;
    if (negs.length > 0) {
      negsRe = new RegExp(negs.join("|"), "i" + uFlag);
      if (terms.length == 0) {
        let idxs = [];
        for (let i = 0;i < haystack.length; i++) {
          if (!negsRe.test(haystack[i]))
            idxs.push(i);
        }
        return [idxs, null, null];
      }
    } else {
      if (terms.length == 0)
        return [null, null, null];
    }
    if (outOfOrder > 0) {
      let terms = split(needle);
      if (terms.length > 1) {
        let terms2 = terms.slice().sort((a, b) => b.length - a.length);
        for (let ti = 0;ti < terms2.length; ti++) {
          if (preFiltered?.length == 0)
            return [[], null, null];
          preFiltered = filter(haystack, terms2[ti], preFiltered);
        }
        if (terms.length > outOfOrder)
          return [preFiltered, null, null];
        needles = permute(terms).map((perm) => perm.join(" "));
        matches = [];
        let matchedIdxs = new Set;
        for (let ni = 0;ni < needles.length; ni++) {
          if (matchedIdxs.size < preFiltered.length) {
            let preFiltered2 = preFiltered.filter((idx) => !matchedIdxs.has(idx));
            let matched = filter(haystack, needles[ni], preFiltered2);
            for (let j = 0;j < matched.length; j++)
              matchedIdxs.add(matched[j]);
            matches.push(matched);
          } else
            matches.push([]);
        }
      }
    }
    if (needles == null) {
      needles = [needle];
      matches = [preFiltered?.length > 0 ? preFiltered : filter(haystack, needle)];
    }
    let retInfo = null;
    let retOrder = null;
    if (negs.length > 0)
      matches = matches.map((idxs) => idxs.filter((idx) => !negsRe.test(haystack[idx])));
    let matchCount = matches.reduce((acc, idxs) => acc + idxs.length, 0);
    if (matchCount <= infoThresh) {
      retInfo = {};
      retOrder = [];
      for (let ni = 0;ni < matches.length; ni++) {
        let idxs = matches[ni];
        if (idxs == null || idxs.length == 0)
          continue;
        let needle = needles[ni];
        let _info = info(idxs, haystack, needle);
        let order = opts.sort(_info, haystack, needle, compare);
        if (ni > 0) {
          for (let i = 0;i < order.length; i++)
            order[i] += retOrder.length;
        }
        for (let k in _info)
          retInfo[k] = (retInfo[k] ?? []).concat(_info[k]);
        retOrder = retOrder.concat(order);
      }
    }
    return [
      [].concat(...matches),
      retInfo,
      retOrder
    ];
  };
  return {
    search: (...args) => {
      let out = _search(...args);
      return out;
    },
    split,
    filter,
    info,
    sort: opts.sort
  };
}
var latinize = (() => {
  let accents = {
    A: "ÁÀÃÂÄĄĂÅ",
    a: "áàãâäąăå",
    E: "ÉÈÊËĖĚ",
    e: "éèêëęě",
    I: "ÍÌÎÏĮİ",
    i: "íìîïįı",
    O: "ÓÒÔÕÖ",
    o: "óòôõö",
    U: "ÚÙÛÜŪŲŮŰ",
    u: "úùûüūųůű",
    C: "ÇČĆ",
    c: "çčć",
    D: "Ď",
    d: "ď",
    G: "Ğ",
    g: "ğ",
    L: "Ł",
    l: "ł",
    N: "ÑŃŇ",
    n: "ñńň",
    S: "ŠŚȘŞ",
    s: "šśșş",
    T: "ŢȚŤ",
    t: "ţțť",
    Y: "Ý",
    y: "ý",
    Z: "ŻŹŽ",
    z: "żźž"
  };
  let accentsMap = {};
  let accentsTpl = "";
  for (let r in accents) {
    accents[r].split("").forEach((a) => {
      accentsTpl += a;
      accentsMap[a] = r;
    });
  }
  let accentsRe = new RegExp(`[${accentsTpl}]`, "g");
  let replacer = (m) => accentsMap[m];
  return (strings) => {
    if (typeof strings == "string")
      return strings.replace(accentsRe, replacer);
    let out = Array(strings.length);
    for (let i = 0;i < strings.length; i++)
      out[i] = strings[i].replace(accentsRe, replacer);
    return out;
  };
})();
function permute(arr) {
  arr = arr.slice();
  let length = arr.length, result = [arr.slice()], c = new Array(length).fill(0), i = 1, k, p;
  while (i < length) {
    if (c[i] < i) {
      k = i % 2 && c[i];
      p = arr[i];
      arr[i] = arr[k];
      arr[k] = p;
      ++c[i];
      i = 1;
      result.push(arr.slice());
    } else {
      c[i] = 0;
      ++i;
    }
  }
  return result;
}
var _mark = (part, matched) => matched ? `<mark>${part}</mark>` : part;
var _append = (acc, part) => acc + part;
function highlight(str, ranges, mark = _mark, accum = "", append = _append) {
  accum = append(accum, mark(str.substring(0, ranges[0]), false)) ?? accum;
  for (let i = 0;i < ranges.length; i += 2) {
    let fr = ranges[i];
    let to = ranges[i + 1];
    accum = append(accum, mark(str.substring(fr, to), true)) ?? accum;
    if (i < ranges.length - 3)
      accum = append(accum, mark(str.substring(ranges[i + 1], ranges[i + 2]), false)) ?? accum;
  }
  accum = append(accum, mark(str.substring(ranges[ranges.length - 1]), false)) ?? accum;
  return accum;
}
uFuzzy.latinize = latinize;
uFuzzy.permute = (arr) => {
  let idxs = permute([...Array(arr.length).keys()]).sort((a, b) => {
    for (let i = 0;i < a.length; i++) {
      if (a[i] != b[i])
        return a[i] - b[i];
    }
    return 0;
  });
  return idxs.map((pi) => pi.map((i) => arr[i]));
};
uFuzzy.highlight = highlight;
export {
  uFuzzy as default
};
