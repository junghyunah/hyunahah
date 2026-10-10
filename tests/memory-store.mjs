// Test fixture only. Production always uses Supabase.
export function memoryStore(initial) {
  let snapshot=structuredClone(initial);
  const documents=new Map();
  return {
    async load(){return structuredClone(snapshot);},
    async save({state,revision,documents:docs=[],passwordHash}){
      if(revision!==snapshot.revision)throw Object.assign(new Error('revision conflict'),{status:409});
      snapshot={state:structuredClone(state),revision:revision+1,passwordHash:passwordHash||snapshot.passwordHash};
      for(const doc of docs)documents.set(`${doc.participant}/${doc.date}`,Buffer.from(doc.pdf));
      return snapshot.revision;
    },
    async document(participant,date){return documents.get(`${participant}/${date}`)||null;}
  };
}
