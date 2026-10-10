export function fixture() {
  return {revision:0,passwordHash:null,state:{settings:{orgName:'테스트복지관',depts:['사업단 1','사업단 2']},participants:[{id:'p1',name:'테스트가',birthDate:'19400101',dept:'사업단 1'},{id:'p2',name:'테스트나',birthDate:'19400202',dept:'사업단 2'}],assignments:[{id:'a1',targetType:'dept',targetDept:'사업단 1',assignDate:'2026-10-01',courseIds:[2,3,4],totalHours:3}],submissions:[],auditLogs:[],customPdfBase64:null}};
}
